/**
 * The `--ion-profile=<dir>` flag: run the shell against an isolated profile.
 *
 * Compatibility runs and smoke tests must never touch the user's normal
 * profile or session, so they point this at a throwaway directory. The flag
 * moves Electron's `userData` (Chromium data, cookies, Ion's own settings)
 * before anything reads a path, which also gives the run its own
 * single-instance lock — an isolated instance cannot collide with a normal
 * Ion window.
 */

import { resolve } from "node:path";

const FLAG = "--ion-profile";

/** Directory for `argv`'s `--ion-profile` value, or null when not passed. */
export function parseProfileArg(argv: readonly string[]): string | null {
  const arg = argv.find((entry) => entry.startsWith(FLAG));
  if (arg === undefined) return null;
  const value = arg.slice(FLAG.length);
  if (!value.startsWith("=") || value.length === 1) return null;
  return resolve(value.slice(1));
}
