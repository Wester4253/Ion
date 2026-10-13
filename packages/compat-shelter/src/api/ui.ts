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
 *   upstream merges in from its own `src/bridges.tsx`. They need Discord's
 *   React instance and are the last piece of stage 2's settings work, so
 *   they are placeholders for now — throwing their own name and the reason,
 *   because a plugin that gets `undefined` instead would report "X is not a
 *   function", which says nothing.
 */

import * as shelterUi from "@uwu/shelter-ui";

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

/** Upstream's React↔Solid bridges, not compiled in yet. */
export const PENDING_BRIDGES = ["ReactInSolidBridge", "renderSolidInReact"] as const;

/** Property reads a placeholder must answer instead of throwing. */
const PASSTHROUGH = new Set<PropertyKey>(["name", "length", "prototype", "constructor"]);

function notAvailable(member: string): never {
  throw new Error(
    `shelter.ui.${member} is not available: it is a React↔Solid bridge that lands with ` +
      `Ion's settings-section support; see docs/status.md`,
  );
}

/**
 * A placeholder that fails by name however it is used: called as a
 * component (`ReactInSolidBridge(props)`) or read as a value. Only the
 * reflection properties the runtime itself reads are answered directly, so
 * an error message can still name the value.
 */
function placeholder(member: string): object {
  return new Proxy(() => undefined, {
    apply: () => notAvailable(member),
    get: (target, property) => {
      if (typeof property === "symbol" || PASSTHROUGH.has(property)) {
        const reflected: unknown = Reflect.get(target, property);
        return reflected;
      }
      return notAvailable(member);
    },
  });
}

/** Upstream's `shelter.ui.injectCss`, re-exported so there is one of them. */
export const { injectCss } = shelterUi;

/** Upstream's `shelter.ui.genId`, re-exported for the same reason. */
export const { genId } = shelterUi;

/**
 * The `shelter.ui` surface: every `@uwu/shelter-ui` export except the four
 * startup helpers, plus the two pending bridges as placeholders.
 */
export interface UiSurface {
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
export function createUiSurface(): UiSurface {
  const surface: Record<string, unknown> = {};
  for (const [member, value] of Object.entries(shelterUi)) {
    if (STARTUP_ONLY.has(member)) continue;
    surface[member] = value;
  }
  for (const member of PENDING_BRIDGES) {
    surface[member] = placeholder(member);
  }
  return surface as UiSurface;
}
