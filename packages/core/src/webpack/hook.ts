/**
 * Interception of Discord's chunk-loading global (`webpackChunkdiscord_app`).
 *
 * The core bundle runs before any page script, so it claims the global first.
 * Bundlers initialize it with `self.x = self.x || []`, so our array survives.
 *
 * The tricky part is the bundler's own setup line (Discord ships rspack):
 *
 *     (f = self.x = self.x || []).forEach(callback.bind(null, 0));
 *     f.push = callback.bind(null, f.push.bind(f));
 *
 * The runtime *reads* `f.push`, binds it, and reassigns `f.push` — and its
 * callback later invokes the captured value (`e && e(chunk)`) to pass the
 * chunk down to the previous chain level. With multiple runtimes on the page
 * (Discord has several) this builds a dispatch chain in which every runtime
 * sees every chunk exactly once, ending in a plain `Array.prototype.push`
 * that buffers the chunk.
 *
 * Our hook mirrors that structure. A single getter cannot work: if it
 * returned one stable function, the runtime's captured `f.push.bind(f)`
 * would be the very same dispatcher it later re-enters — infinite recursion
 * allocating args arrays until the renderer OOMs (this happened; see
 * packages/core/src/webpack/hook.test.ts for the regression test). Instead,
 * every assignment creates a fresh entry function that dispatches through
 * the *newly* installed callback while freezing its own dispatch target, so
 * a captured entry always leads one level down the chain and terminates in
 * the buffering entry. `onModules` wraps each factory on the way past.
 *
 * Only the innermost (buffering) entry appends to the array, exactly like
 * the bundler expects when it replays the buffer via `forEach`.
 */

import type { ModuleFactory } from "./types";

export const CHUNK_GLOBAL = "webpackChunkdiscord_app";

type PushCallback = (...args: unknown[]) => unknown;

export interface ChunkHook {
  /** The (hooked) chunk array, now installed on the scope. */
  readonly array: unknown[];
  /** True once the bundler runtime has installed its own push callback. */
  isWebpackActive(): boolean;
}

/** Wrap the factories of one pushed chunk, in place. */
function wrapChunkArgument(
  chunk: unknown,
  onModules: (modules: Record<string, ModuleFactory>) => void,
): void {
  // Chunks are pushed as one argument: [[ids], { id: factory, ... }, runtime?]
  if (!Array.isArray(chunk)) return;
  const modules = (chunk as readonly unknown[])[1];
  if (modules != null && typeof modules === "object") {
    onModules(modules as Record<string, ModuleFactory>);
  }
}

/**
 * Install the hook into `scope` (the real call passes `window`).
 *
 * `onModules` receives the raw modules object of each push — mutating it in
 * place (replacing factories with wrapped versions) is the intended use.
 */
export function installChunkHook(
  scope: Record<string, unknown>,
  onModules: (modules: Record<string, ModuleFactory>) => void,
): ChunkHook {
  const existing = scope[CHUNK_GLOBAL];
  const array: unknown[] = Array.isArray(existing) ? existing : [];
  scope[CHUNK_GLOBAL] = array;

  let webpackActive = false;
  let currentEntry: PushCallback = makeEntry(undefined);

  function makeEntry(dispatch: PushCallback | undefined): PushCallback {
    return (...args: unknown[]): unknown => {
      wrapChunkArgument(args[0], onModules);
      if (dispatch) return dispatch(...args);
      return Array.prototype.push.call(array, ...args);
    };
  }

  Object.defineProperty(array, "push", {
    configurable: true,
    enumerable: false,
    get: () => currentEntry,
    set: (value: unknown) => {
      // Only a function can be the bundler's callback; anything else falls
      // back to buffering rather than crashing later pushes.
      webpackActive = typeof value === "function";
      currentEntry = makeEntry(webpackActive ? (value as PushCallback) : undefined);
    },
  });

  return { array, isWebpackActive: () => webpackActive };
}
