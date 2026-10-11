/**
 * Locating the Ion core and UI bundles.
 *
 * In development the bundles live in the sibling `packages/core` and
 * `packages/ui` workspace packages; the loader takes the candidates and the
 * reader as inputs so it stays pure and unit-tested. `ION_CORE_BUNDLE` and
 * `ION_UI_BUNDLE` override the lookups. The UI bundle is optional: the shell
 * still runs without it (the settings page simply won't exist), but the core
 * bundle is required.
 */

import { resolve } from "node:path";

export type CoreBundleResult =
  | {
      readonly ok: true;
      readonly source: string;
      readonly file: string;
      /** True when the settings-UI bundle was found and appended. */
      readonly ui: boolean;
    }
  | { readonly ok: false; readonly tried: readonly string[]; readonly reason: string };

export function coreBundleCandidates(
  envBundle: string | undefined,
  shellDistDir: string,
): string[] {
  const devSibling = resolve(shellDistDir, "..", "..", "core", "dist", "index.js");
  return envBundle ? [envBundle, devSibling] : [devSibling];
}

export function uiBundleCandidates(
  envUiBundle: string | undefined,
  shellDistDir: string,
): string[] {
  const devSibling = resolve(shellDistDir, "..", "..", "ui", "dist", "index.js");
  return envUiBundle ? [envUiBundle, devSibling] : [devSibling];
}

type FirstResult =
  | { readonly ok: true; readonly source: string; readonly file: string }
  | { readonly ok: false; readonly tried: readonly string[]; readonly reason: string };

/**
 * Read the first candidate that exists; `read` throws for missing files so
 * the loader can fall through to the next candidate.
 */
function loadFirst(candidates: readonly string[], read: (file: string) => string): FirstResult {
  const tried: string[] = [];
  let lastError: unknown = "no candidate could be read";
  for (const candidate of candidates) {
    tried.push(candidate);
    try {
      const source = read(candidate);
      if (source.length > 0) return { ok: true, source, file: candidate };
      return { ok: false, tried, reason: `bundle at ${candidate} is empty` };
    } catch (error) {
      // Candidate missing or unreadable; try the next one, keep the reason.
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  return { ok: false, tried, reason: detail };
}

/**
 * Load the core bundle (required) and append the UI bundle (optional) so the
 * shell evaluates both in a single script injection.
 */
export function loadCoreBundle(
  envCoreBundle: string | undefined,
  envUiBundle: string | undefined,
  shellDistDir: string,
  read: (file: string) => string,
): CoreBundleResult {
  const core = loadFirst(coreBundleCandidates(envCoreBundle, shellDistDir), read);
  if (!core.ok) return core;

  const ui = loadFirst(uiBundleCandidates(envUiBundle, shellDistDir), read);
  if (!ui.ok) return { ok: true, source: core.source, file: core.file, ui: false };
  return { ok: true, source: `${core.source}\n;\n${ui.source}`, file: core.file, ui: true };
}
