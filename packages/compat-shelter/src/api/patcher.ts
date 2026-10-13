/**
 * `shelter.patcher` — Spitroast's monkey-patch trio.
 *
 * `after`, `before`, and `instead` come straight from spitroast (CC0-1.0,
 * the library upstream depends on; see THIRD_PARTY.md) so `this`, the
 * argument-array contract of `before`, and the chained-original behaviour of
 * `instead` are the ones plugins were written against rather than a
 * reimplementation of them. `unpatchAll` is deliberately not exposed:
 * upstream strips it from `shelter.patcher` too, so a plugin that needs it
 * is relying on something the real API does not offer.
 *
 * The scoped variant additionally records each unpatch for
 * `disposeAllNow()` and runs the plugin's callback under that plugin's log
 * scope, so a callback that reports a failure is attributed to the plugin
 * that registered it.
 */

import { after, before, instead } from "spitroast";

import type { PluginScope } from "../logger";

import { runInPluginScope } from "../logger";

/** What a plugin's `after` callback receives: the args and the original result. */
export type AfterCallback = (this: unknown, args: unknown[], ret: unknown) => unknown;
/** What a plugin's `before` callback receives: the args, optionally rewritten. */
export type BeforeCallback = (this: unknown, args: unknown[]) => unknown;
/** What a plugin's `instead` callback receives: the args and the original. */
export type InsteadCallback = (
  this: unknown,
  args: unknown[],
  original: (...args: unknown[]) => unknown,
) => unknown;

/** Removes the patch again. */
export type Unpatch = () => boolean;

export interface PatcherSurface {
  after(funcName: string, funcParent: object, callback: AfterCallback, oneTime?: boolean): Unpatch;
  before(
    funcName: string,
    funcParent: object,
    callback: BeforeCallback,
    oneTime?: boolean,
  ): Unpatch;
  instead(
    funcName: string,
    funcParent: object,
    callback: InsteadCallback,
    oneTime?: boolean,
  ): Unpatch;
}

/**
 * Spitroast's generics resolve `funcName` against `keyof P` and the callback
 * against `Parameters<P[N]>` — neither can be expressed for an object a
 * plugin supplies at runtime. The runtime contract (`name, parent, callback,
 * oneTime?` → unpatch) is what plugins depend on, so the boundary is cast
 * once here instead of at every call site.
 */
type SpitroastEntry = (
  funcName: string,
  funcParent: object,
  callback: (...args: never[]) => unknown,
  oneTime?: boolean,
) => Unpatch;

const spitroastAfter = after as unknown as SpitroastEntry;
const spitroastBefore = before as unknown as SpitroastEntry;
const spitroastInstead = instead as unknown as SpitroastEntry;

/** Unpatch functions a scoped patcher owns and `disposeAllNow` replays. */
type Disposer = () => void;

export interface PatcherOptions {
  /** Collected unpatches; omitted for the window-level patcher. */
  readonly disposes?: Disposer[];
  /** Plugin whose code a callback belongs to; omitted at window level. */
  readonly scope?: PluginScope;
}

/** Records an unpatch when this patcher is scoped. */
function remember(options: PatcherOptions, unpatch: Unpatch): Unpatch {
  options.disposes?.push(unpatch);
  return unpatch;
}

/** Runs a plugin callback under its own log scope, preserving `this`. */
function scoped<A extends unknown[], R>(
  scope: PluginScope | undefined,
  callback: (this: unknown, ...args: A) => R,
): (this: unknown, ...args: A) => R {
  if (scope === undefined) return callback;
  return function (this: unknown, ...args: A): R {
    return runInPluginScope(scope, () => callback.apply(this, args));
  };
}

/**
 * Builds a patcher. With neither option it is the plain window-level
 * surface; with both, the per-plugin one the scoped API hands out.
 */
export function createPatcher(options: PatcherOptions = {}): PatcherSurface {
  return {
    after(funcName, funcParent, callback, oneTime) {
      const wrapped = scoped(options.scope, callback);
      return remember(options, spitroastAfter(funcName, funcParent, wrapped, oneTime));
    },
    before(funcName, funcParent, callback, oneTime) {
      const wrapped = scoped(options.scope, callback);
      return remember(options, spitroastBefore(funcName, funcParent, wrapped, oneTime));
    },
    instead(funcName, funcParent, callback, oneTime) {
      const wrapped = scoped(options.scope, callback);
      return remember(options, spitroastInstead(funcName, funcParent, wrapped, oneTime));
    },
  };
}
