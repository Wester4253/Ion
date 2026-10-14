/**
 * Module filters — the predicates behind findByProps/findByCode/findStore.
 * Semantics mirror Vencord's public `filters` object.
 */

import { canonicalizeMatch } from "../patches";

export type ModuleFilter = (exports: unknown, id: PropertyKey) => boolean;

export type CodeFilter = readonly (string | RegExp)[];

function isIndexable(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/** Whether every code fragment appears in the source of a function. */
export function stringMatches(source: string, fragments: CodeFilter): boolean {
  return fragments.every((fragment) => {
    if (typeof fragment === "string") return source.includes(fragment);
    resetRegExp(fragment);
    return fragment.test(source);
  });
}

function resetRegExp(regexp: RegExp): void {
  if (regexp.global || regexp.sticky) regexp.lastIndex = 0;
}

/**
 * Whether `prop` resolves through a real property descriptor — an own
 * property or one inherited along the prototype chain.
 *
 * A Proxy whose `get` trap fabricates values (react-aria's defaulting
 * context proxies, Discord's i18n message table) answers `obj[prop]` for
 * every string while carrying no descriptor anywhere, so a value check
 * alone lets those artifacts masquerade as any module — react-aria's
 * proxy matched `byProps("dispatch", "subscribe")` and poisoned
 * `FluxDispatcher`. Every genuine module export — plain object props,
 * `Object.defineProperty` getters, class instances — has descriptors, so
 * requiring one rejects only the fabrications.
 */
function hasPropertyDescriptor(exports: object, prop: string): boolean {
  let current: object | null = exports;
  while (current !== null) {
    try {
      if (Object.getOwnPropertyDescriptor(current, prop) !== undefined) return true;
      // The prototype is an object or null by definition; the builtin is
      // typed `any`, so narrow it back at the boundary.
      current = Object.getPrototypeOf(current) as object | null;
    } catch {
      // A trap throwing during the walk is not a match.
      return false;
    }
  }
  return false;
}

export const filters = {
  /**
   * Modules that expose all the given property names. The value must be
   * defined *and* backed by a real descriptor; see
   * {@link hasPropertyDescriptor}.
   */
  byProps:
    (...props: string[]): ModuleFilter =>
    (exports) => {
      if (!isIndexable(exports)) return false;
      // Value check first: it is the cheap one and rejects ordinary misses
      // before any prototype walk.
      return props.every(
        (prop) => exports[prop] !== undefined && hasPropertyDescriptor(exports, prop),
      );
    },

  /** Functions whose source contains all the given fragments. */
  byCode:
    (...code: CodeFilter): ModuleFilter =>
    (exports) => {
      if (typeof exports !== "function") return false;
      return stringMatches(Function.prototype.toString.call(exports), code.map(canonicalizeMatch));
    },

  /** Flux stores identified by their constructor's displayName. */
  byStoreName:
    (name: string): ModuleFilter =>
    (exports) => {
      if (!isIndexable(exports)) return false;
      const constructor: unknown = exports.constructor;
      return (constructor as { displayName?: string } | undefined)?.displayName === name;
    },
};
