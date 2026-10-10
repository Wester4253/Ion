/**
 * Module filters — the predicates behind findByProps/findByCode/findStore.
 * Semantics mirror Vencord's public `filters` object.
 */

import { canonicalizeMatch } from "../patches";

export type ModuleFilter = (exports: unknown) => boolean;

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

export const filters = {
  /** Modules that expose all the given property names. */
  byProps:
    (...props: string[]): ModuleFilter =>
    (exports) => {
      if (!isIndexable(exports)) return false;
      return props.every((prop) => exports[prop] !== undefined);
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
