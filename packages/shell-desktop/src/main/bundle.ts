/**
 * Locating the Ion core bundle and the optional bundles appended after it.
 *
 * In development the bundles live in the sibling workspace packages; the
 * loader takes the candidates and the reader as inputs so it stays pure and
 * unit-tested. Environment overrides (`ION_CORE_BUNDLE`, `ION_UI_BUNDLE`,
 * `ION_COMPAT_VENCORD_BUNDLE`, `ION_COMPAT_BD_BUNDLE`,
 * `ION_COMPAT_SHELTER_BUNDLE`) take priority over the sibling lookup. The
 * appended bundles are optional: the shell still runs without them (no
 * settings page, no compat adapters), but the core bundle is required.
 *
 * Evaluation order is core → UI → compat adapters: adapters register their
 * translated plugins against the host core already set up.
 */

import { resolve } from "node:path";

/**
 * The name every injected script reports in its stack frames.
 *
 * The shell evaluates core, ui, and the adapters as *one* script, so V8
 * applies a single `sourceURL` to every frame it produces — the last one in
 * the source wins. Each bundle keeps its own name for standalone use, but
 * the shell appends this one last, so a stack frame from the Shelter adapter
 * says `ion://ion/injection.js` rather than claiming to be
 * `ion://compat-vencord/index.js` (which is what the harness used to report
 * for shelter failures: the Vencord bundle's footer is the last `sourceURL`
 * in the concatenated source, so it named every frame).
 */
export const INJECTION_SOURCE_URL = "ion://ion/injection.js";
export interface OptionalBundle {
  readonly name: string;
  readonly candidates: readonly string[];
  /** True when the bundle was found and appended. */
  readonly loaded: boolean;
}

export type CoreBundleResult =
  | {
      readonly ok: true;
      readonly source: string;
      readonly file: string;
      readonly optional: readonly OptionalBundle[];
      /** True when the settings-UI bundle was found and appended. */
      readonly ui: boolean;
      /** True when the Vencord adapter bundle was found and appended. */
      readonly compatVencord: boolean;
      /** True when the BetterDiscord adapter bundle was found and appended. */
      readonly compatBd: boolean;
      /** True when the Shelter adapter bundle was found and appended. */
      readonly compatShelter: boolean;
    }
  | { readonly ok: false; readonly tried: readonly string[]; readonly reason: string };

function candidatesFor(envBundle: string | undefined, devSibling: string): string[] {
  return envBundle ? [envBundle, devSibling] : [devSibling];
}

export function coreBundleCandidates(
  envBundle: string | undefined,
  shellDistDir: string,
): string[] {
  return candidatesFor(envBundle, resolve(shellDistDir, "..", "..", "core", "dist", "index.js"));
}

export function uiBundleCandidates(
  envUiBundle: string | undefined,
  shellDistDir: string,
): string[] {
  return candidatesFor(envUiBundle, resolve(shellDistDir, "..", "..", "ui", "dist", "index.js"));
}

export function compatVencordBundleCandidates(
  envBundle: string | undefined,
  shellDistDir: string,
): string[] {
  return candidatesFor(
    envBundle,
    resolve(shellDistDir, "..", "..", "compat-vencord", "dist", "index.js"),
  );
}

export function compatBdBundleCandidates(
  envBundle: string | undefined,
  shellDistDir: string,
): string[] {
  return candidatesFor(
    envBundle,
    resolve(shellDistDir, "..", "..", "compat-bd", "dist", "index.js"),
  );
}

export function compatShelterBundleCandidates(
  envBundle: string | undefined,
  shellDistDir: string,
): string[] {
  return candidatesFor(
    envBundle,
    resolve(shellDistDir, "..", "..", "compat-shelter", "dist", "index.js"),
  );
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
 * Load the core bundle (required) and append the optional bundles (UI, then
 * the Vencord, BetterDiscord, and Shelter adapters) so the shell evaluates
 * everything in one script injection. Missing optional bundles only narrow
 * the feature set; the loader reports which ones landed.
 */
export function loadCoreBundle(
  envCoreBundle: string | undefined,
  envUiBundle: string | undefined,
  shellDistDir: string,
  read: (file: string) => string,
  envCompatVencordBundle?: string,
  envCompatBdBundle?: string,
  envCompatShelterBundle?: string,
): CoreBundleResult {
  const core = loadFirst(coreBundleCandidates(envCoreBundle, shellDistDir), read);
  if (!core.ok) return core;

  const optionalSpecs: readonly {
    readonly name: string;
    readonly candidates: readonly string[];
  }[] = [
    { name: "ui", candidates: uiBundleCandidates(envUiBundle, shellDistDir) },
    {
      name: "compat-vencord",
      candidates: compatVencordBundleCandidates(envCompatVencordBundle, shellDistDir),
    },
    { name: "compat-bd", candidates: compatBdBundleCandidates(envCompatBdBundle, shellDistDir) },
    {
      name: "compat-shelter",
      candidates: compatShelterBundleCandidates(envCompatShelterBundle, shellDistDir),
    },
  ];

  const optional: OptionalBundle[] = [];
  let source = core.source;
  for (const spec of optionalSpecs) {
    const loaded = loadFirst(spec.candidates, read);
    optional.push({ name: spec.name, candidates: spec.candidates, loaded: loaded.ok });
    if (loaded.ok) source = `${source}\n;\n${loaded.source}`;
  }

  const loadedNames = new Set(optional.filter((entry) => entry.loaded).map((entry) => entry.name));
  return {
    ok: true,
    source: `${source}\n//# sourceURL=${INJECTION_SOURCE_URL}\n`,
    file: core.file,
    optional,
    ui: loadedNames.has("ui"),
    compatVencord: loadedNames.has("compat-vencord"),
    compatBd: loadedNames.has("compat-bd"),
    compatShelter: loadedNames.has("compat-shelter"),
  };
}
