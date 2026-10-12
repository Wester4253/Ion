/**
 * Harness-only command-line flags.
 *
 * The compatibility harness passes these alongside `--ion-smoke` so a run
 * can pre-enable foreign-format plugins before the compat bundle evaluates
 * (their settings store reads localStorage synchronously at injection) and
 * control how long the smoke soaks before it collects its report. Outside
 * harness runs the flags are absent and nothing changes.
 *
 * Pure and unit-tested: no Electron imports.
 */

const SEED_FLAG = "--ion-seed-vencord-settings";
const SETTLE_FLAG = "--ion-smoke-settle-ms";

/** Raw Vencord settings JSON for `--ion-seed-vencord-settings=`, or null. */
export function parseSeedVencordSettingsArg(argv: readonly string[]): string | null {
  const arg = argv.find((entry) => entry.startsWith(SEED_FLAG));
  if (arg === undefined) return null;
  const value = arg.slice(SEED_FLAG.length);
  if (!value.startsWith("=") || value.length === 1) return null;
  return value.slice(1);
}

/** Milliseconds for `--ion-smoke-settle-ms=<n>`, or null when absent/invalid. */
export function parseSmokeSettleArg(argv: readonly string[]): number | null {
  const arg = argv.find((entry) => entry.startsWith(SETTLE_FLAG));
  if (arg === undefined) return null;
  const value = arg.slice(SETTLE_FLAG.length);
  if (!value.startsWith("=") || value.length === 1) return null;
  const ms = Number(value.slice(1));
  return Number.isInteger(ms) && ms > 0 ? ms : null;
}
