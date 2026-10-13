/**
 * compat-harness CLI — runs a seeded smoke of an ecosystem's acceptance set
 * and turns its report into per-plugin verdicts plus the generated
 * scoreboard (docs/compat.md or docs/compat-bd.md).
 *
 * The electron launch itself stays in scripts/smoke.mjs (one place owns
 * nice/ionice, isolated profiles, and the report contract); this runner only
 * adds the seed (all acceptance plugins enabled), chooses the soak window,
 * and classifies the outcome.
 *
 * Ecosystems:
 * - vencord (default): seeds every acceptance plugin on in Vencord's
 *   settings (upstream only registers patches for enabled plugins).
 * - bd: BetterDiscord plugins are plain files, so the runner downloads each
 *   acceptance entry from its sha256-pinned raw URL, verifies the hash, and
 *   stages the files into `<profile>/ion/bd/plugins` before launch. The
 *   profile is a throwaway temp dir owned (and cleaned up) by this runner,
 *   unless `--profile` names one explicitly.
 *
 * Usage:
 *   node dist/index.js [--ecosystem vencord|bd] [--out <dir>]
 *                      [--settle-ms <n>] [--profile <dir>] [--docs <path>]
 *                      [--report <smoke-report.json>]
 *
 * Exit code 0 only for a healthy run with no failed plugins: warnings and
 * documented deferrals are recorded, never hidden.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderCompatMarkdown } from "./markdown";
import { analyze, type AcceptanceEntry, type Ecosystem, type SmokeReport } from "./report";

const DEFAULT_SETTLE_MS = 180_000;
/** Slack on top of the soak before the smoke's own timeout fires. */
const SMOKE_MARGIN_MS = 120_000;

interface CliOptions {
  readonly ecosystem: Ecosystem;
  readonly out: string | null;
  readonly settleMs: number;
  readonly profile: string | null;
  readonly docs: string | null;
  readonly reportOnly: string | null;
}

const USAGE = `compat-harness — score an ecosystem's acceptance set

  --ecosystem NAME   vencord (default) or bd
  --out DIR          run artifacts (default: compat-runs/<timestamp>)
  --settle-ms N      soak window before the report (default: ${String(DEFAULT_SETTLE_MS)})
  --profile DIR      isolated profile (default: a throwaway temp profile)
  --docs PATH        generated scoreboard (default: docs/compat.md, or
                     docs/compat-bd.md for --ecosystem bd)
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

const VALUE_FLAGS = ["--ecosystem", "--out", "--settle-ms", "--profile", "--docs", "--report"];

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

  const ecosystemRaw = valueOf(argv, "--ecosystem") ?? "vencord";
  if (ecosystemRaw !== "vencord" && ecosystemRaw !== "bd") {
    throw new Error(`unknown --ecosystem: ${ecosystemRaw} (expected vencord or bd)`);
  }
  const ecosystem: Ecosystem = ecosystemRaw;

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
    ecosystem,
    out: valueOf(argv, "--out"),
    settleMs,
    profile: valueOf(argv, "--profile"),
    docs: valueOf(argv, "--docs"),
    reportOnly: valueOf(argv, "--report"),
  };
}

/** Repository root: this file lives at packages/compat-harness/dist/. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** An isolated profile the runner launched against. */
interface RunProfile {
  readonly dir: string;
  /** True when this runner created the profile and must delete it after. */
  readonly owned: boolean;
}

/**
 * Downloads and hash-verifies every acceptance entry, staging the files
 * into `<profile>/ion/bd/plugins`. Throws on any network or hash failure —
 * an unverifiable plugin never reaches the client.
 */
async function stageBdPlugins(
  profileDir: string,
  acceptance: readonly AcceptanceEntry[],
  artifactsDir: string,
): Promise<void> {
  const pluginsDir = resolve(profileDir, "ion", "bd", "plugins");
  await mkdir(pluginsDir, { recursive: true });
  const staged: { name: string; url: string; sha256: string; file: string }[] = [];

  for (const entry of acceptance) {
    if (entry.url === undefined || entry.sha256 === undefined) {
      throw new Error(`acceptance entry ${entry.name} needs url + sha256 for --ecosystem bd`);
    }
    const response = await fetch(entry.url);
    if (!response.ok) {
      throw new Error(`download failed for ${entry.name}: HTTP ${String(response.status)}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== entry.sha256) {
      throw new Error(
        `sha256 mismatch for ${entry.name}: pinned ${entry.sha256}, downloaded ${digest}`,
      );
    }
    const file = basename(new URL(entry.url).pathname);
    await writeFile(resolve(pluginsDir, file), bytes);
    staged.push({ name: entry.name, url: entry.url, sha256: digest, file });
  }

  // Provenance travels with the run artifacts: every staged file, its
  // pinned source, and the verified digest.
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(resolve(artifactsDir, "bd-staged.json"), `${JSON.stringify(staged, null, 2)}\n`);
}

async function runSmoke(
  options: CliOptions,
  smokeOut: string,
  extra: readonly string[],
  profile: RunProfile | null,
): Promise<number> {
  const root = repoRoot();
  const args = [
    resolve(root, "scripts", "smoke.mjs"),
    "--out",
    smokeOut,
    "--timeout",
    String(Math.ceil((options.settleMs + SMOKE_MARGIN_MS) / 1000)),
    ...(profile === null ? [] : ["--profile", profile.dir]),
    "--",
    ...extra,
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
  const isBd = options.ecosystem === "bd";
  const acceptancePath = isBd
    ? resolve(root, "packages", "compat-bd", "acceptance.json")
    : resolve(root, "packages", "compat-vencord", "acceptance.json");
  // The Vencord file is a bare array; the BD file carries a source/note
  // wrapper around its `entries`.
  const document = JSON.parse(await readFile(acceptancePath, "utf8")) as
    AcceptanceEntry[] | { entries: AcceptanceEntry[] };
  const acceptance = Array.isArray(document) ? document : document.entries;

  let upstream: string;
  if (isBd) {
    upstream = "133bc83 (Apache-2.0 port of BdApi)";
  } else {
    const manifest = JSON.parse(
      await readFile(
        resolve(root, "packages", "compat-vencord", "vendor", "vencord", "MANIFEST.json"),
        "utf8",
      ),
    ) as { source?: { version?: string; commit?: string } };
    upstream = `${manifest.source?.version ?? "unknown"} (${(manifest.source?.commit ?? "unknown").slice(0, 7)})`;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = options.out ?? resolve(root, "compat-runs", stamp);
  const smokeOut = resolve(out, "smoke");
  const reportPath = options.reportOnly ?? resolve(smokeOut, "report.json");
  const docs = options.docs ?? resolve(root, "docs", isBd ? "compat-bd.md" : "compat.md");

  let profile: RunProfile | null = null;
  try {
    if (options.reportOnly === null) {
      await mkdir(smokeOut, { recursive: true });
      const extra: string[] = [`--ion-smoke-settle-ms=${String(options.settleMs)}`];
      if (isBd) {
        // BetterDiscord plugins are files, not settings: stage a verified
        // copy into an isolated profile this runner owns.
        const dir = options.profile ?? (await mkdtemp(join(tmpdir(), "ion-bd-profile-")));
        profile = { dir, owned: options.profile === null };
        await stageBdPlugins(dir, acceptance, out);
      } else {
        // Every acceptance plugin enabled: upstream only registers patches
        // for enabled plugins, so a default-off profile would prove nothing.
        extra.push(
          `--ion-seed-vencord-settings=${JSON.stringify({
            plugins: Object.fromEntries(acceptance.map((entry) => [entry.name, { enabled: true }])),
          })}`,
        );
        if (options.profile !== null) profile = { dir: options.profile, owned: false };
      }
      const smokeExit = await runSmoke(options, smokeOut, extra, profile);
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
      ecosystem: options.ecosystem,
      upstream,
    });
    const markdown = renderCompatMarkdown(report);

    await mkdir(out, { recursive: true });
    await writeFile(resolve(out, "compat-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(docs, markdown);

    const { summary, meta } = report;
    const failed = report.plugins.filter((plugin) => plugin.status === "fail");
    process.stdout.write(
      `[compat] ${String(summary.total)} plugins: ${String(summary.pass)} pass, ` +
        `${String(summary.warnings)} warnings, ${String(summary.fail)} fail, ` +
        `${String(summary.deferred)} deferred · tier2 ` +
        `${meta.tier2Run ? "measured" : "not run"} · scoreboard: ${docs}\n`,
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
  } finally {
    if (profile?.owned === true) {
      await rm(profile.dir, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`[compat] harness error: ${String(error)}\n`);
  process.exitCode = 1;
}
