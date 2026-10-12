/**
 * `BdApi.Patcher` — BetterDiscord's monkey-patching surface. Behavioral
 * port of BetterDiscord's src/betterdiscord/api/patcher.ts (Apache-2.0, see
 * THIRD_PARTY.md): the same validation order and error messages, the same
 * non-string guard rails on `getPatchesByCaller`/`unpatchAll`, and the same
 * split between the name-taking static surface and the pre-scoped
 * `BoundPatcher` handed out by `new BdApi(name)`.
 *
 * Validation runs through the `unknown`-typed helpers below rather than the
 * generically-typed parameters, because the checks must stay live at
 * runtime: plugins are plain JavaScript and pass anything — while the typed
 * parameters would let TypeScript narrow them into "always true" conditions
 * that lint (rightly) refuses.
 */

import { Logger } from "../common/logger";
import MainPatcher from "../modules/patcher";
import type {
  AfterCallback,
  BeforeCallback,
  GenericChildPatch,
  InsteadCallback,
  StringKeys,
  UnpatchFunction,
} from "../modules/patcher";

/**
 * The callback type each patch method accepts, gated on the patched member
 * actually being a function — upstream's conditional types, without `any`:
 * non-function members resolve to `never`, so passing a callback for them
 * is a type error for TypeScript consumers (JavaScript plugins still hit
 * the runtime validation).
 */
type AsBeforeCallback<M extends object, K extends StringKeys<M>> = M[K] extends (
  ...args: infer A
) => unknown
  ? BeforeCallback<A>
  : never;
type AsInsteadCallback<M extends object, K extends StringKeys<M>> = M[K] extends (
  ...args: infer A
) => unknown
  ? InsteadCallback<A>
  : never;
type AsAfterCallback<M extends object, K extends StringKeys<M>> = M[K] extends (
  ...args: infer A
) => unknown
  ? AfterCallback<A>
  : never;

/**
 * Upstream's `isModuleInvalid`, minus its final `!== null` clause: `typeof
 * null` is `"object"`, so that clause can never change the result. Only
 * primitives are rejected — `null` passes on purpose, and the engine treats
 * it as an unresolvable module.
 */
function isModuleInvalid(moduleToPatch: unknown): boolean {
  return typeof moduleToPatch !== "object" && typeof moduleToPatch !== "function";
}

/** Validation for the static surface: callback, name, module, caller. */
function validateParams(
  caller: unknown,
  moduleToPatch: unknown,
  functionName: unknown,
  callback: unknown,
): void {
  if (typeof callback !== "function") throw new Error("4th parameter should be function");
  if (typeof functionName !== "string") throw new Error("3rd parameter should be function name");
  if (isModuleInvalid(moduleToPatch)) throw new Error("2nd parameter should be module");
  if (typeof caller !== "string") throw new Error("1st parameter should be string");
}

/** Validation for the bound surface: callback, name, module (caller is scoped). */
function validateBoundParams(
  moduleToPatch: unknown,
  functionName: unknown,
  callback: unknown,
): void {
  if (typeof callback !== "function") throw new Error("3rd parameter should be function");
  if (typeof functionName !== "string") throw new Error("2nd parameter should be function name");
  if (isModuleInvalid(moduleToPatch)) throw new Error("1st parameter should be module");
}

/** Upstream logs (error level) and returns `undefined` for non-string ids. */
function validateCallerId(caller: unknown, method: "getPatchesByCaller" | "unpatchAll"): boolean {
  if (typeof caller === "string") return true;
  Logger.error(
    "BdApi.Patcher",
    `Parameter 0 of ${method} must be a string representing the caller`,
  );
  return false;
}

/**
 * `Patcher` is a utility class for modifying existing functions. An instance
 * is available on {@link BdApi}. This is extremely useful for modifying the
 * internals of Discord by adjusting return values of React renders, or
 * arguments of internal functions.
 */
export class Patcher {
  /**
   * Patches onto another function, allowing your code to run beforehand —
   * including modifying the incoming arguments before the original runs.
   *
   * @param caller Name of the caller; undo every patch of the same name with
   *   {@link unpatchAll}. Use `""` if you don't care.
   * @param moduleToPatch Object with the function to be patched. Can also be an object's prototype.
   * @param functionName Name of the method to be patched.
   * @param callback Function to run before the original; receives the `this`
   *   context and the (mutable) `arguments` of the original call.
   * @returns Function that cancels this patch — run it when your plugin stops.
   */
  before<M extends object, K extends StringKeys<M>>(
    caller: string,
    moduleToPatch: M,
    functionName: K,
    callback: AsBeforeCallback<M, K>,
  ): UnpatchFunction | null {
    validateParams(caller, moduleToPatch, functionName, callback);
    return MainPatcher.pushChildPatch(caller, moduleToPatch, functionName, callback, {
      type: "before",
    });
  }

  /**
   * Patches onto another function, allowing your code to run instead — the
   * original only runs if your callback (or a later one) calls it.
   *
   * @param caller Name of the caller; undo every patch of the same name with
   *   {@link unpatchAll}. Use `""` if you don't care.
   * @param moduleToPatch Object with the function to be patched. Can also be an object's prototype.
   * @param functionName Name of the method to be patched.
   * @param callback Function to run instead; receives the `this` context, the
   *   `arguments`, and the original function for continuing the chain.
   * @returns Function that cancels this patch — run it when your plugin stops.
   */
  instead<M extends object, K extends StringKeys<M>>(
    caller: string,
    moduleToPatch: M,
    functionName: K,
    callback: AsInsteadCallback<M, K>,
  ): UnpatchFunction | null {
    validateParams(caller, moduleToPatch, functionName, callback);
    return MainPatcher.pushChildPatch(caller, moduleToPatch, functionName, callback, {
      type: "instead",
    });
  }

  /**
   * Patches onto another function, allowing your code to run afterwards —
   * including replacing the original's return value.
   *
   * @param caller Name of the caller; undo every patch of the same name with
   *   {@link unpatchAll}. Use `""` if you don't care.
   * @param moduleToPatch Object with the function to be patched. Can also be an object's prototype.
   * @param functionName Name of the method to be patched.
   * @param callback Function to run after; receives the `this` context, the
   *   `arguments`, and the return value of the original call.
   * @returns Function that cancels this patch — run it when your plugin stops.
   */
  after<M extends object, K extends StringKeys<M>>(
    caller: string,
    moduleToPatch: M,
    functionName: K,
    callback: AsAfterCallback<M, K>,
  ): UnpatchFunction | null {
    validateParams(caller, moduleToPatch, functionName, callback);
    return MainPatcher.pushChildPatch(caller, moduleToPatch, functionName, callback, {
      type: "after",
    });
  }

  /**
   * Returns all patches by a particular caller. The patches all have an
   * `unpatch()` method.
   *
   * @param caller ID the original patches were made with.
   */
  getPatchesByCaller(caller: string): GenericChildPatch[] | undefined {
    if (!validateCallerId(caller, "getPatchesByCaller")) return undefined;
    return MainPatcher.getPatchesByCaller(caller);
  }

  /** Automatically cancels all patches created with a specific ID. */
  unpatchAll(caller: string): void {
    if (!validateCallerId(caller, "unpatchAll")) return;
    MainPatcher.unpatchAll(caller);
  }
}

/**
 * `BoundPatcher` is a utility class for modifying existing functions, with
 * plugin scoping automatically supplied. An instance is available on
 * instances of {@link BdApi}.
 */
export class BoundPatcher {
  readonly #callerName: string;

  constructor(callerName: string) {
    this.#callerName = callerName;
  }

  /**
   * Patches onto another function, allowing your code to run beforehand —
   * including modifying the incoming arguments before the original runs.
   *
   * @param moduleToPatch Object with the function to be patched. Can also be an object's prototype.
   * @param functionName Name of the method to be patched.
   * @param callback Function to run before the original; receives the `this`
   *   context and the (mutable) `arguments` of the original call.
   * @returns Function that cancels this patch — run it when your plugin stops.
   */
  before<M extends object, K extends StringKeys<M>>(
    moduleToPatch: M,
    functionName: K,
    callback: AsBeforeCallback<M, K>,
  ): UnpatchFunction | null {
    validateBoundParams(moduleToPatch, functionName, callback);
    return MainPatcher.pushChildPatch(this.#callerName, moduleToPatch, functionName, callback, {
      type: "before",
    });
  }

  /**
   * Patches onto another function, allowing your code to run instead — the
   * original only runs if your callback (or a later one) calls it.
   *
   * @param moduleToPatch Object with the function to be patched. Can also be an object's prototype.
   * @param functionName Name of the method to be patched.
   * @param callback Function to run instead; receives the `this` context, the
   *   `arguments`, and the original function for continuing the chain.
   * @returns Function that cancels this patch — run it when your plugin stops.
   */
  instead<M extends object, K extends StringKeys<M>>(
    moduleToPatch: M,
    functionName: K,
    callback: AsInsteadCallback<M, K>,
  ): UnpatchFunction | null {
    validateBoundParams(moduleToPatch, functionName, callback);
    return MainPatcher.pushChildPatch(this.#callerName, moduleToPatch, functionName, callback, {
      type: "instead",
    });
  }

  /**
   * Patches onto another function, allowing your code to run afterwards —
   * including replacing the original's return value.
   *
   * @param moduleToPatch Object with the function to be patched. Can also be an object's prototype.
   * @param functionName Name of the method to be patched.
   * @param callback Function to run after; receives the `this` context, the
   *   `arguments`, and the return value of the original call.
   * @returns Function that cancels this patch — run it when your plugin stops.
   */
  after<M extends object, K extends StringKeys<M>>(
    moduleToPatch: M,
    functionName: K,
    callback: AsAfterCallback<M, K>,
  ): UnpatchFunction | null {
    validateBoundParams(moduleToPatch, functionName, callback);
    return MainPatcher.pushChildPatch(this.#callerName, moduleToPatch, functionName, callback, {
      type: "after",
    });
  }

  /** Returns all patches by this bound api. The patches all have an `unpatch()` method. */
  getPatchesByCaller(): GenericChildPatch[] {
    return MainPatcher.getPatchesByCaller(this.#callerName);
  }

  /** Automatically cancels all patches created by this bound api. */
  unpatchAll(): void {
    MainPatcher.unpatchAll(this.#callerName);
  }
}

Object.freeze(Patcher);
Object.freeze(Patcher.prototype);
Object.freeze(BoundPatcher);
Object.freeze(BoundPatcher.prototype);
