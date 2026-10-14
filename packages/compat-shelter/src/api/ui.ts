/**
 * `shelter.ui` — Shelter's component library.
 *
 * The components are `@uwu/shelter-ui` itself: Solid JSX that Ion compiles
 * with upstream's own toolchain (babel-preset-solid through esbuild), so a
 * plugin gets the library that ships with shelter rather than a
 * reimplementation of it (CC0-1.0, see THIRD_PARTY.md). What this file owns
 * is the *surface*: which of the library's exports a plugin may reach, and
 * what happens to the ones it may not.
 *
 * Two exclusions, both upstream's:
 *
 * - `cleanupCss`, `initToasts`, `injectInternalStyles` and `InternalStyles`
 *   are stripped from `shelter.ui` in upstream's `windowApi.ts`, because
 *   they are startup's own bookkeeping: a plugin that called them could
 *   tear down the toast container and the styles every other plugin is
 *   using. The adapter runs them itself while the API is built (see
 *   `api/index.ts`).
 * - `ReactInSolidBridge` and `renderSolidInReact` are the two bridges
 *   upstream merges in from its own `src/bridges.tsx`. Ion ships them for
 *   real (see `bridges.tsx`) because Discord's React instance is resolvable
 *   through Ion's own module discovery; when a session cannot resolve it,
 *   both still fail naming themselves rather than reporting `undefined is
 *   not a function`, which says nothing.
 */

import * as shelterUi from "@uwu/shelter-ui";

import type { ReactSurface } from "./react";
import { createBridges, type ShelterBridges } from "./bridges";

/**
 * Upstream's `without(...)` exclusions. Stripped from `shelter.ui`, called
 * by the adapter instead.
 */
const STARTUP_ONLY = new Set<string>([
  "cleanupCss",
  "initToasts",
  "injectInternalStyles",
  "InternalStyles",
]);

/** Upstream's `shelter.ui.injectCss`, re-exported so there is one of them. */
export const { injectCss } = shelterUi;

/** Upstream's `shelter.ui.genId`, re-exported for the same reason. */
export const { genId } = shelterUi;

/**
 * The `shelter.ui` surface: every `@uwu/shelter-ui` export except the four
 * startup helpers, plus the two React↔Solid bridges.
 */
export interface UiSurface extends ShelterBridges {
  injectCss: typeof shelterUi.injectCss;
  genId: typeof shelterUi.genId;
  /** Opens a Solid modal; available since the library was compiled in. */
  openModal: typeof shelterUi.openModal;
  [member: string]: unknown;
}

/**
 * Builds the `shelter.ui` surface from the compiled library.
 *
 * Membership is decided by the package's own export list rather than a
 * hardcoded one, so a library upgrade that adds a component makes it
 * available to plugins without this file having to notice. The four
 * startup helpers are removed by name, and `api/ui.test.ts` checks that
 * this list and the package's exports agree.
 */
export function createUiSurface(react: ReactSurface): UiSurface {
  const surface: Record<string, unknown> = {};
  for (const [member, value] of Object.entries(shelterUi)) {
    if (STARTUP_ONLY.has(member)) continue;
    surface[member] = value;
  }
  return { ...surface, ...createBridges(react) } as UiSurface;
}
