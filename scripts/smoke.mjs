/**
 * Headless smoke runner for compatibility work.
 *
 * Launches the desktop shell with an isolated profile (never the user's
 * normal Ion profile or session), hidden + offscreen (nothing appears on
 * screen, no focus stealing), at idle I/O and CPU priority, waits for the
 * harness to write `report.json`, prints it, and exits non-zero when a
 * required probe is missing.
 *
 * Usage:
 *   node scripts/smoke.mjs [--out DIR] [--profile DIR] [--timeout SEC] [-- electron args...]
 *
 * Everything after `--` is passed to Electron verbatim (e.g. an extra
 * `--remote-debugging-port` for CDP probing).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const options = { out: null, profile: null, timeoutSec: 120, extra: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      options.extra = argv.slice(i + 1);
      break;
    } else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--profile") options.profile = argv[++i];
    else if (arg === "--timeout") options.timeoutSec = Number(argv[++i]);
    else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(options.timeoutSec) || options.timeoutSec <= 0) {
    throw new Error("--timeout must be a positive number of seconds");
  }
  return options;
}

/** Probes that must be present and truthy for the run to count as green. */
const REQUIRED_ALWAYS = ["ionShellPreload", "coreInjected", "discoveryReady", "debugPanelMounted"];

/** Extra probes only expected when the app is past the login screen. */
const REQUIRED_IN_APP = ["ionTabMounted", "ionPanelActive"];

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const outDir = resolve(options.out ?? join(repoRoot, "..", "ion-smoke-out"));
  mkdirSync(outDir, { recursive: true });
  const profileDir =
    options.profile !== null
      ? resolve(options.profile)
      : await mkdtemp(join(tmpdir(), "ion-profile-"));
  const ownProfile = options.profile === null;

  const electron = join(repoRoot, "packages", "shell-desktop", "node_modules", ".bin", "electron");
  const mainCjs = join(repoRoot, "packages", "shell-desktop", "dist", "main.cjs");

  const args = [mainCjs, `--ion-smoke=${outDir}`, `--ion-profile=${profileDir}`, ...options.extra];

  // Idle priority (nice 19, ionice class 3): compatibility runs must not
  // steal CPU or disk from games. `ionice` is Linux-only; fall back to
  // plain `nice` when it is missing.
  const hasIonice = existsSync("/usr/bin/ionice") || existsSync("/bin/ionice");
  const wrapper = hasIonice ? "ionice" : "nice";
  const wrapperArgs = hasIonice
    ? ["-c", "3", "nice", "-n", "19", electron, ...args]
    : ["-n", "19", electron, ...args];

  const child = spawn(wrapper, wrapperArgs, {
    stdio: ["ignore", "inherit", "inherit"],
    // Electron's dev-mode page warnings (Discord's CSP allows unsafe-eval) are
    // noise in the report; real renderer errors still surface through the
    // console-message hook.
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, options.timeoutSec * 1000);

  const exitCode = await new Promise((resolveExit) => {
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
  clearTimeout(timeout);

  let report = null;
  try {
    report = JSON.parse(await readFile(join(outDir, "report.json"), "utf8"));
  } catch {
    // Missing report: handled below.
  }

  const failures = [];
  if (report === null) failures.push("report.json was not written");
  else {
    const required =
      report.session === "in-app" ? [...REQUIRED_ALWAYS, ...REQUIRED_IN_APP] : REQUIRED_ALWAYS;
    for (const key of required) {
      if (report[key] !== true) failures.push(`${key} is ${JSON.stringify(report[key])}`);
    }
    const errors = report.rendererErrors ?? [];
    if (errors.length > 0) failures.push(`rendererErrors: ${errors.slice(0, 3).join(" | ")}`);
  }
  if (timedOut) failures.push(`timed out after ${options.timeoutSec}s`);
  else if (exitCode !== 0) failures.push(`electron exited with code ${exitCode}`);

  if (ownProfile) await rm(profileDir, { recursive: true, force: true });

  if (failures.length > 0) {
    process.stderr.write(`smoke FAILED:\n- ${failures.join("\n- ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
