/**
 * compat-harness CLI — runs a seeded smoke of the acceptance set and turns
 * its report into per-plugin verdicts plus the generated docs/compat.md.
 *
 * The electron launch itself stays in scripts/smoke.mjs (one place owns
 * nice/ionice, isolated profiles, and the report contract); this runner only
 * adds the seed (all acceptance plugins enabled), chooses the soak window,
 * and classifies the outcome.
 *
 * Usage:
 *   node dist/index.js [--out <dir>] [--settle-ms <n>] [--profile <dir>]
 *                      [--docs <path>] [--report <smoke-report.json>]
 *
 * Exit code 0 only for a healthy run with no failed plugins: warnings and
 * documented deferrals are recorded, never hidden.
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderCompatMarkdown } from "./markdown";
import { analyze, type AcceptanceEntry, type SmokeReport } from "./report";

const DEFAULT_SETTLE_MS = 180_000;
/** Slack on top of the soak before the smoke's own timeout fires. */
const SMOKE_MARGIN_MS = 120_000;

interface CliOptions {
  readonly out: string | null;
  readonly settleMs: number;
  readonly profile: string | null;
  readonly docs: string;
  readonly reportOnly: string | null;
}

const USAGE = `compat-harness — score the Vencord/Equicord acceptance set

  --out DIR          run artifacts (default: compat-runs/<timestamp>)
  --settle-ms N      soak window before the report (default: ${String(DEFAULT_SETTLE_MS)})
  --profile DIR      isolated profile (default: a throwaway temp profile)
  --docs PATH        generated scoreboard (default: docs/compat.md)
  --report PATH      analyze an existing smoke report.json; do not run
  --help             this text
`;

/** Value of `--flag VALUE` or `--flag=VALUE`, or null when absent. */
function valueOf(argv: readonly string[], flag: string): string | null {
  const eq = argv.find((entry) => entry.startsWith(`${flag}=`));
  if (eq !== undefined) {
    const value = eq.slice(flag.length + 1);
    return value.length > 0 ? value : null;
  }
  const index = argv.indexOf(flag);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1] ?? null;
  return null;
}

const VALUE_FLAGS = ["--out", "--settle-ms", "--profile", "--docs", "--report"];

function parseArgs(argv: readonly string[]): CliOptions | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (flag === "--help" || flag === "-h") continue;
    if (!VALUE_FLAGS.includes(flag)) throw new Error(`unknown argument: ${arg}`);
    if (!arg.includes("=")) {
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      i += 1; // consume the space-separated value
    }
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return null;
  }

  const settleRaw = valueOf(argv, "--settle-ms");
  let settleMs = DEFAULT_SETTLE_MS;
  if (settleRaw !== null) {
    const parsed = Number(settleRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`invalid --settle-ms: ${settleRaw}`);
    }
    settleMs = parsed;
  }
  return {
    out: valueOf(argv, "--out"),
    settleMs,
    profile: valueOf(argv, "--profile"),
    docs: valueOf(argv, "--docs") ?? resolve(repoRoot(), "docs", "compat.md"),
    reportOnly: valueOf(argv, "--report"),
  };
}

/** Repository root: this file lives at packages/compat-harness/dist/. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

async function runSmoke(options: CliOptions, smokeOut: string, seed: string): Promise<number> {
  const root = repoRoot();
  const args = [
    resolve(root, "scripts", "smoke.mjs"),
    "--out",
    smokeOut,
    "--timeout",
    String(Math.ceil((options.settleMs + SMOKE_MARGIN_MS) / 1000)),
    ...(options.profile === null ? [] : ["--profile", options.profile]),
    "--",
    `--ion-seed-vencord-settings=${seed}`,
    `--ion-smoke-settle-ms=${String(options.settleMs)}`,
  ];
  return await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", cwd: root });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolveExit(code ?? 1);
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) return;

  const root = repoRoot();
  const acceptance = JSON.parse(
    await readFile(resolve(root, "packages", "compat-vencord", "acceptance.json"), "utf8"),
  ) as AcceptanceEntry[];
  const manifest = JSON.parse(
    await readFile(
      resolve(root, "packages", "compat-vencord", "vendor", "vencord", "MANIFEST.json"),
      "utf8",
    ),
  ) as { source?: { version?: string; commit?: string } };
  const upstream = `${manifest.source?.version ?? "unknown"} (${(manifest.source?.commit ?? "unknown").slice(0, 7)})`;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = options.out ?? resolve(root, "compat-runs", stamp);
  const smokeOut = resolve(out, "smoke");
  const reportPath = options.reportOnly ?? resolve(smokeOut, "report.json");

  if (options.reportOnly === null) {
    await mkdir(smokeOut, { recursive: true });
    // Every acceptance plugin enabled: upstream only registers patches for
    // enabled plugins, so a default-off profile would prove nothing.
    const seed = JSON.stringify({
      plugins: Object.fromEntries(acceptance.map((entry) => [entry.name, { enabled: true }])),
    });
    const smokeExit = await runSmoke(options, smokeOut, seed);
    process.stdout.write(`[compat] smoke exited ${String(smokeExit)}\n`);
  }

  let smoke: SmokeReport;
  try {
    smoke = JSON.parse(await readFile(reportPath, "utf8")) as SmokeReport;
  } catch (error) {
    process.stderr.write(
      `[compat] no smoke report at ${reportPath} — the run did not produce one (${String(error)})\n`,
    );
    process.exitCode = 1;
    return;
  }

  const report = analyze(smoke, acceptance, {
    generatedAt: new Date().toISOString(),
    upstream,
  });
  const markdown = renderCompatMarkdown(report);

  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, "compat-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.docs, markdown);

  const { summary, meta } = report;
  const failed = report.plugins.filter((plugin) => plugin.status === "fail");
  process.stdout.write(
    `[compat] ${String(summary.total)} plugins: ${String(summary.pass)} pass, ` +
      `${String(summary.warnings)} warnings, ${String(summary.fail)} fail, ` +
      `${String(summary.deferred)} deferred · tier2 ` +
      `${meta.tier2Run ? "measured" : "not run"} · scoreboard: ${options.docs}\n`,
  );
  for (const plugin of failed) {
    process.stderr.write(`[compat] FAIL ${plugin.name}: ${plugin.reason ?? "unknown"}\n`);
  }
  if (!report.runHealthy) {
    for (const error of report.run.rendererErrors) {
      process.stderr.write(`[compat] renderer error: ${error}\n`);
    }
    process.stderr.write("[compat] run unhealthy: unexpected renderer errors\n");
  }
  if (failed.length > 0 || !report.runHealthy) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`[compat] harness error: ${String(error)}\n`);
  process.exitCode = 1;
}
