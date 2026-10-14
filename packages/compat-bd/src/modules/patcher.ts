/**
 * BetterDiscord's patch engine — a behavioral port of
 * src/betterdiscord/modules/patcher.ts (Apache-2.0, see THIRD_PARTY.md).
 *
 * One `GenericPatch` is registered per patched function; any number of
 * callers ("child patches") can then run before, instead of, or after that
 * function without knowing about each other. Dispatch semantics are
 * upstream's, quirks included: `instead` callbacks that return `undefined`
 * never reach the original, the chain's terminal wrapper only runs when the
 * last `instead` calls the function it was handed, and the last child to
 * unpatch reverts the function entirely.
 *
 * Deliberate deviations, all recorded in THIRD_PARTY.md:
 * - Upstream's core class also exposes static `before`/`after`/`instead`,
 *   which only BetterDiscord's own modules call. Ion does not port those
 *   modules, so the engine is reached through the validating `BdApi.Patcher`
 *   facade (src/api/patcher.ts) and those unreachable entry points are
 *   omitted rather than left dead.
 * - Callback exceptions are reported through the failing caller's bound
 *   logger (upstream uses the common logger), and an unpatchable target
 *   warns instead of returning `null` silently — both so the compat harness
 *   can attribute every failure to the plugin that caused it. Message texts
 *   stay upstream's, and the common logger still handles anonymous callers.
 * - `resolveModule`'s string form (`DiscordModules[name]`) is unreachable
 *   through the facade — strings fail its module validation — and is
 *   omitted. Its falsy form normalizes to `null` before the caller's
 *   `if (!module)` check, which is behavior-identical.
 */

import { boundLoggerFor } from "../api/logger";
import { byKeys } from "../api/webpack/filters";
import { getModule } from "../api/webpack/search";
import { Logger } from "../common/logger";

/** Keys of `T` that are strings — upstream's `StringKeys` helper type. */
export type StringKeys<T extends object> = Extract<keyof T, string>;

/** Cancels a patch; returned by every facade patch method. */
export type UnpatchFunction = () => void;

/** The three places a callback can hook a patched function. */
export type PatchType = "before" | "instead" | "after";

/**
 * A patched function as the engine sees it. Real signatures are unknowable,
 * so arguments travel as `unknown[]`. `__originalFunction` is attached to
 * the installed override exactly as upstream attaches it — plugins read it.
 */
export interface PatchFunction {
  (this: unknown, ...args: unknown[]): unknown;
  __originalFunction?: PatchFunction;
}

/** Runs before the original; may mutate `args` in place. */
export type BeforeCallback<A extends readonly unknown[] = readonly unknown[]> = (
  thisObject: unknown,
  args: A,
) => unknown;

/** Runs instead of the original; `originalFunction` continues the chain. */
export type InsteadCallback<A extends readonly unknown[] = readonly unknown[]> = (
  thisObject: unknown,
  args: A,
  originalFunction: (...args: A) => unknown,
) => unknown;

/** Runs after the original; returning non-undefined replaces its result. */
export type AfterCallback<A extends readonly unknown[] = readonly unknown[]> = (
  thisObject: unknown,
  args: A,
  returnValue: unknown,
) => unknown;

export interface PatchOptions {
  /** A meaningful name for `moduleToPatch`; used for the patch's debug name. */
  displayName?: string;
  /** Patch even if the function doesn't exist (installs a noop). Defaults to true. */
  forcePatch?: boolean;
  /** The type of patch. Defaults to "after". */
  type?: PatchType;
}

/** One patched function, shared by every caller that hooks it. */
export interface GenericPatch {
  name: string;
  module: object;
  functionName: string;
  originalFunction: PatchFunction;
  proxyFunction: PatchFunction | undefined;
  /**
   * Restores the original function. As upstream documents, calling it also
   * destroys every patch added to the same function after this one.
   */
  revert: () => void;
  counter: number;
  children: GenericChildPatch[];
}

/** One caller's hook on a patched function. */
export interface GenericChildPatch {
  caller: string;
  type: PatchType;
  id: number;
  /**
   * Runtime-only: before/instead/after callbacks have different shapes, so
   * the engine stores them opaquely and invokes them through the two typed
   * helpers below (which preserve upstream's exact argument counts).
   */
  callback: unknown;
  unpatch: UnpatchFunction;
}

type TwoArgCallback = (thisObject: unknown, args: unknown[]) => unknown;
type ThreeArgCallback = (thisObject: unknown, args: unknown[], extra: unknown) => unknown;

function readProp(target: object, key: string): unknown {
  return (target as Record<string, unknown>)[key];
}

function writeProp(target: object, key: string, value: unknown): void {
  try {
    (target as Record<string, unknown>)[key] = value;
  } catch {
    // The property exists as a getter-only accessor (no setter). Replace the
    // full descriptor so the write succeeds; upstream BD behaves the same way
    // because it also performs a direct assignment.
    Object.defineProperty(target, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

/** Upstream invokes before-callbacks with exactly `(thisObject, args)`. */
function callBefore(callback: unknown, thisObject: unknown, args: unknown[]): void {
  (callback as TwoArgCallback)(thisObject, args);
}

/** Upstream invokes instead/after callbacks with exactly `(thisObject, args, extra)`. */
function callWithExtra(
  callback: unknown,
  thisObject: unknown,
  args: unknown[],
  extra: unknown,
): unknown {
  return (callback as ThreeArgCallback)(thisObject, args, extra);
}

function asObject(value: unknown): object | undefined {
  if (typeof value === "object" && value !== null) return value;
  if (typeof value === "function") return value;
  return undefined;
}

function readName(target: object | undefined, key: "displayName" | "name"): unknown {
  return target ? readProp(target, key) : undefined;
}

/** The first non-empty string, mirroring upstream's `||` chain of names. */
function firstString(...candidates: readonly unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "") return candidate;
  }
  return "anonymous";
}

/** Upstream's displayName chain: options, the module, then its constructor. */
function patchName(module: object, options: PatchOptions): string {
  const constructor = asObject(readProp(module, "constructor"));
  return firstString(
    options.displayName,
    readName(module, "displayName"),
    readName(module, "name"),
    readName(constructor, "displayName"),
    readName(constructor, "name"),
  );
}

function reportCallbackError(
  phase: PatchType,
  functionName: string,
  caller: string,
  error: unknown,
): void {
  // Upstream's message, verbatim; only the logger differs (see the file
  // header) — the caller's bound name is what makes the failure attributable.
  const message = `Could not fire ${phase} callback of ${functionName} for ${caller}`;
  if (caller) {
    boundLoggerFor(caller).error(message, error);
    return;
  }
  Logger.error("Patcher", message, error);
}

function warnUnpatchable(caller: string, functionName: string, reason: string): void {
  const message = `Could not patch ${functionName}: ${reason}`;
  if (caller) {
    boundLoggerFor(caller).warn(message);
    return;
  }
  Logger.warn("Patcher", message);
}

/**
 * The patch engine. Upstream keeps this stateful surface on a class of
 * statics; only the entry points the facade (or tests) can reach exist here.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- upstream keeps the engine's state and entry points on a class of statics; mirroring that keeps this file diffable against BetterDiscord's source.
export default class Patcher {
  static readonly #patches: GenericPatch[] = [];

  /** Every registered patch, in registration order (upstream's debug view). */
  static get patches(): GenericPatch[] {
    return Patcher.#patches;
  }

  /**
   * Returns all patches done by a specific caller. Upstream returns `[]`
   * for falsy names so unpatch-on-stop code never has to guard.
   */
  static getPatchesByCaller(name: string): GenericChildPatch[] {
    if (!name) return [];
    const patches: GenericChildPatch[] = [];
    for (const patch of Patcher.#patches) {
      for (const childPatch of patch.children) {
        if (childPatch.caller === name) patches.push(childPatch);
      }
    }
    return patches;
  }

  /** Unpatches the given patches, or every patch made by the given caller. */
  static unpatchAll(patches: string | GenericChildPatch[]): void {
    const targets = typeof patches === "string" ? Patcher.getPatchesByCaller(patches) : patches;
    for (const patch of targets) {
      patch.unpatch();
    }
  }

  /** The module forms plugins may pass: an object, or keys to look up. */
  private static resolveModule(module: object | null): object | null {
    if (Array.isArray(module)) return getModule(byKeys(module as string[])) as object | null;
    return module ?? null;
  }

  /** The dispatcher installed in place of the original function. */
  private static makeOverride(patch: GenericPatch): PatchFunction {
    return function BDPatcher(this: unknown, ...args: unknown[]): unknown {
      let returnValue: unknown;

      if (patch.children.length === 0) return patch.originalFunction.apply(this, args);
      for (const superPatch of patch.children.filter((child) => child.type === "before")) {
        try {
          callBefore(superPatch.callback, this, args);
        } catch (error) {
          reportCallbackError("before", patch.functionName, superPatch.caller, error);
        }
      }

      const insteads = patch.children.filter((child) => child.type === "instead");
      if (insteads.length === 0) {
        returnValue = patch.originalFunction.apply(this, args);
      } else {
        const getPatch = (index: number): PatchFunction => {
          const insteadPatch = insteads[index];
          if (!insteadPatch) {
            return function (this: unknown, ...innerArgs: unknown[]): unknown {
              if (returnValue === undefined) {
                returnValue = patch.originalFunction.apply(this, innerArgs);
                return returnValue;
              }
              return patch.originalFunction.apply(this, innerArgs);
            };
          }

          return function (this: unknown, ...innerArgs: unknown[]): unknown {
            try {
              const tempReturn = callWithExtra(
                insteadPatch.callback,
                this,
                innerArgs,
                getPatch(index + 1),
              );
              if (tempReturn !== undefined) returnValue = tempReturn;
            } catch (error) {
              reportCallbackError("instead", patch.functionName, insteadPatch.caller, error);
            }

            return returnValue;
          };
        };

        getPatch(0).apply(this, args);
      }

      for (const slavePatch of patch.children.filter((child) => child.type === "after")) {
        try {
          const tempReturn = callWithExtra(slavePatch.callback, this, args, returnValue);
          if (tempReturn !== undefined) returnValue = tempReturn;
        } catch (error) {
          reportCallbackError("after", patch.functionName, slavePatch.caller, error);
        }
      }
      return returnValue;
    };
  }

  /** Re-installs the dispatcher of a patch whose override was reverted. */
  private static rePatch(patch: GenericPatch): void {
    const override = Patcher.makeOverride(patch);
    patch.proxyFunction = override;
    writeProp(patch.module, patch.functionName, override);
  }

  /** Registers and installs a fresh patch wrapping `module[functionName]`. */
  private static makePatch(module: object, functionName: string, name: string): GenericPatch {
    const originalFunction = readProp(module, functionName) as PatchFunction;
    const patch: GenericPatch = {
      name,
      module,
      functionName,
      originalFunction,
      proxyFunction: undefined,
      revert: () => {
        writeProp(patch.module, patch.functionName, patch.originalFunction);
        patch.proxyFunction = undefined;
        patch.children = [];
      },
      counter: 0,
      children: [],
    };
    const override = Patcher.makeOverride(patch);
    writeProp(module, functionName, override);
    Object.assign(override, originalFunction);
    override.__originalFunction = originalFunction;
    override.toString = () => originalFunction.toString();
    patch.proxyFunction = override;
    Patcher.#patches.push(patch);
    return patch;
  }

  /**
   * Runs `callback` before, instead of, or after
   * `moduleToPatch[functionName]`. Plugins reach this through `BdApi.Patcher`
   * (src/api/patcher.ts), which validates the arguments first.
   *
   * @returns A function that cancels this patch, or `null` when the target
   *   could not be patched (which is also warned about, attributed to `caller`).
   */
  static pushChildPatch(
    caller: string,
    moduleToPatch: object,
    functionName: string,
    callback: unknown,
    options: PatchOptions = {},
  ): UnpatchFunction | null {
    const { type = "after", forcePatch = true } = options;
    const module = Patcher.resolveModule(moduleToPatch);
    if (!module) {
      warnUnpatchable(caller, functionName, "the module could not be resolved");
      return null;
    }
    if (!readProp(module, functionName) && forcePatch) {
      writeProp(module, functionName, () => undefined);
    }
    if (!(readProp(module, functionName) instanceof Function)) {
      warnUnpatchable(caller, functionName, "the target is not a function");
      return null;
    }

    const patchId = `${patchName(module, options)}.${functionName}`;
    const patch =
      Patcher.#patches.find(
        (registered) => registered.module === module && registered.functionName === functionName,
      ) ?? Patcher.makePatch(module, functionName, patchId);
    if (!patch.proxyFunction) Patcher.rePatch(patch);

    const child: GenericChildPatch = {
      caller,
      type,
      id: patch.counter,
      callback,
      unpatch: () => {
        const index = patch.children.findIndex(
          (candidate) => candidate.id === child.id && candidate.type === type,
        );

        if (index === -1) return;

        patch.children.splice(index, 1);

        if (patch.children.length <= 0) {
          const patchNum = Patcher.#patches.findIndex(
            (registered) =>
              registered.module === module && registered.functionName === functionName,
          );
          const registered = Patcher.#patches[patchNum];
          if (patchNum < 0 || !registered) return;
          registered.revert();
          Patcher.#patches.splice(patchNum, 1);
        }
      },
    };
    patch.children.push(child);
    patch.counter++;
    return child.unpatch;
  }
}
