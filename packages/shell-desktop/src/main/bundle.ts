/**
 * Locating the Ion core bundle.
 *
 * In development the bundle lives in the sibling `packages/core` workspace;
 * the loader takes the candidates and the reader as inputs so it stays pure
 * and unit-tested. `ION_CORE_BUNDLE` overrides the lookup.
 */

import { resolve } from "node:path";

export type CoreBundleResult =
  | { readonly ok: true; readonly source: string; readonly file: string }
  | { readonly ok: false; readonly tried: readonly string[]; readonly reason: string };

export function coreBundleCandidates(
  envBundle: string | undefined,
  shellDistDir: string,
): string[] {
  const devSibling = resolve(shellDistDir, "..", "..", "core", "dist", "index.js");
  return envBundle ? [envBundle, devSibling] : [devSibling];
}

/**
 * Read the first candidate that exists; `read` throws for missing files so
 * the loader can fall through to the next candidate.
 */
export function loadCoreBundle(
  envBundle: string | undefined,
  shellDistDir: string,
  read: (file: string) => string,
): CoreBundleResult {
  const tried: string[] = [];
  let lastError: unknown = "no candidate could be read";
  for (const candidate of coreBundleCandidates(envBundle, shellDistDir)) {
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
