/**
 * BetterDiscord's webpack filter functions — a behavioral port of
 * BetterDiscord's src/betterdiscord/webpack/filter.ts and shared.ts
 * (Apache-2.0, see THIRD_PARTY.md).
 *
 * Filters run against the live module caches the Ion core captured
 * (`window.__ION__.discovery.getRequires()`): `require.c` entries carry the
 * module record, and `require.m[id]` supplies the factory source for
 * `bySource`. The token-store and collection exclusions in
 * `wrapModuleFilter` are upstream's own guard rails, and they double as an
 * Ion hard rule: filters can never reach Discord's auth-token module.
 */

import { Logger } from "../../common/logger";
import { getType } from "../../utils/react";
import { discovery } from "../../host";
import type { BdModule, ExportedOnlyFilter, ModuleFilter } from "./types";

/** Upstream tags every built-in filter with this symbol for introspection. */
const BD_FILTER = Symbol.for("BetterDiscord.Filter");

const identity: ExportedOnlyFilter = (exports) => exports;

function assign<T extends ModuleFilter | ExportedOnlyFilter>(filter: T, args: unknown): T {
  return Object.assign(filter, { [BD_FILTER]: args });
}

function isIndexable(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function defaultOf(exports: unknown): unknown {
  return (exports as { default?: unknown } | null | undefined)?.default;
}

/** The methods of Discord's collection-like exports upstream skips. */
interface CollectionLike {
  remove?: unknown;
  set?: unknown;
  clear?: unknown;
  get?: unknown;
  sort?: unknown;
}

/** The auth-token surface upstream keeps filters away from (Ion hard rule). */
interface TokenSurface {
  getToken?: unknown;
  getEmail?: unknown;
  showToken?: unknown;
}

/** A module whose exports are all the get/set/clear/get collection methods — upstream skips those. */
function isCollection(value: unknown): boolean {
  if (!isIndexable(value)) return false;
  const candidate = value as CollectionLike;
  return Boolean(
    candidate.remove && candidate.set && candidate.clear && candidate.get && !candidate.sort,
  );
}

/** Modules exposing the auth-token surface — upstream skips them, and Ion never hands them out. */
function exposesToken(value: unknown): boolean {
  if (!isIndexable(value)) return false;
  const candidate = value as TokenSurface;
  return Boolean(candidate.getToken ?? candidate.getEmail ?? candidate.showToken);
}

export function byKeys(
  props: readonly string[],
  filter: ExportedOnlyFilter = identity,
): ExportedOnlyFilter {
  return assign(
    (exports) => {
      if (!exports) return false;
      if (!isIndexable(exports)) return false;
      const component = filter(exports);
      if (!isIndexable(component)) return false;
      for (const prop of props) {
        if (!(prop in component)) return false;
      }
      return true;
    },
    { props, filter },
  );
}

export function byPrototypeKeys(
  fields: readonly string[],
  filter: ExportedOnlyFilter = identity,
): ExportedOnlyFilter {
  return assign(
    (exports) => {
      if (!exports) return false;
      if (!isIndexable(exports)) return false;
      const component = filter(exports);
      if (!component) return false;
      if (!isIndexable(component)) return false;
      const prototype: unknown = component["prototype"];
      if (!isIndexable(prototype)) return false;
      for (const field of fields) {
        if (!(field in prototype)) return false;
      }
      return true;
    },
    { fields, filter },
  );
}

export function byRegex(search: RegExp, filter: ExportedOnlyFilter = identity): ExportedOnlyFilter {
  return assign(
    (exports) => {
      const method = filter(exports);
      if (!method) return false;
      let methodString: string;
      try {
        methodString = (method as { toString(argument: []): string }).toString([]);
      } catch {
        methodString = (method as { toString(): string }).toString();
      }
      return methodString.search(search) !== -1;
    },
    { search, filter },
  );
}

/** Factory source for a module id across every captured bundler runtime. */
function factoryFor(id: PropertyKey): unknown {
  for (const webpackRequire of discovery().getRequires()) {
    const factory = webpackRequire.m[id];
    if (factory !== undefined) return factory;
  }
  return undefined;
}

export function bySource(...searches: readonly (string | RegExp)[]): ModuleFilter {
  return assign(
    (_exports, module) => {
      const id = module.id;
      if (!id) return false;
      const factory = factoryFor(id);
      if (factory === undefined) return false;
      let source: string;
      try {
        source = Function.prototype.toString.call(factory);
      } catch {
        return false;
      }
      if (!source) return false;
      for (const search of searches) {
        if (typeof search === "string") {
          if (!source.includes(search)) return false;
        } else {
          if (!search.test(source)) return false;
        }
      }
      return true;
    },
    { searches },
  );
}

export function byStrings(...strings: readonly string[]): ExportedOnlyFilter {
  return assign(
    (exports) => {
      if (typeof exports !== "function") return false;
      let source: string;
      try {
        source = String(exports);
      } catch {
        return false;
      }
      return strings.every((string) => source.includes(string));
    },
    { strings },
  );
}

export function byDisplayName(name: string): ExportedOnlyFilter {
  return assign(
    (exports) => exports != null && (exports as { displayName?: string }).displayName === name,
    { name },
  );
}

export function byStoreName(name: string): ExportedOnlyFilter {
  return assign(
    (exports) => {
      if (exports == null) return false;
      const store = exports as { _dispatchToken?: unknown; getName?: () => string };
      return Boolean(store._dispatchToken) && store.getName?.() === name;
    },
    { name },
  );
}

export function combine(...filters: readonly ModuleFilter[]): ModuleFilter {
  return assign(
    (exports, module, id) => {
      for (const filter of filters) {
        if (!filter(exports, module, id)) return false;
      }
      return true;
    },
    { filters },
  );
}

export function not(filter: ModuleFilter): ModuleFilter {
  return assign((exports, module, id) => !filter(exports, module, id), { filter });
}

export function byComponentType(filter: ExportedOnlyFilter): ExportedOnlyFilter {
  return assign(
    (exports) => {
      const component = getType(exports);
      return typeof component === "function" && filter(component);
    },
    { filter },
  );
}

/** `%TypedArray%` — the prototype every typed array shares (used by `instanceof`). */
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array) as abstract new (
  ...args: never[]
) => unknown;

export function shouldSkipModule(exports: unknown): boolean {
  if (exports == null) return true;
  const kind = typeof exports;
  if (kind !== "object" && kind !== "function") return true;
  if ((exports as { TypedArray?: unknown }).TypedArray) return true;
  if (typeof Window !== "undefined") {
    if (exports === window) return true;
    if (exports === document.documentElement) return true;
  }
  if ((exports as { [Symbol.toStringTag]?: string })[Symbol.toStringTag] === "DOMTokenList")
    return true;
  if (exports === Symbol) return true;
  if (typeof Window !== "undefined" && exports instanceof Window) return true;
  if (exports instanceof typedArrayPrototype) return true;
  const loader = exports as {
    $$loader?: unknown;
    $$baseObject?: unknown;
    Z?: { $$loader?: unknown; $$baseObject?: unknown };
  };
  const innerLoader = loader.Z;
  if (
    (loader.$$loader && loader.$$baseObject) ||
    (innerLoader?.$$loader && innerLoader.$$baseObject)
  ) {
    return true;
  }
  return false;
}

const thrownFilters = new WeakSet<ModuleFilter>();

/**
 * Upstream's filter wrapper: keeps token/DOM-collection modules out of
 * reach and turns a throwing plugin filter into a warn-once miss instead
 * of an exception escaping the search.
 */
export function wrapModuleFilter(filter: ModuleFilter): ModuleFilter {
  const wrapped: ModuleFilter = (exports, module, id) => {
    try {
      if (typeof Window !== "undefined" && exports instanceof Window) return false;
      if (isCollection(exports) || isCollection(defaultOf(exports))) return false;
      if (exposesToken(exports) || exposesToken(defaultOf(exports))) return false;
      return filter(exports, module, id);
    } catch (error) {
      if (!thrownFilters.has(filter)) {
        Logger.warn("WebpackModules~getModule", "Module filter threw an exception.", error, {
          filter,
          module,
        });
      }
      thrownFilters.add(filter);
      return false;
    }
  };
  return wrapped;
}

/** The key upstream prefers when descending into a module's default export. */
export function getDefaultKey(module: BdModule): "A" | "Ay" | "default" | undefined {
  const exports = module.exports;
  if (!isIndexable(exports)) return undefined;
  if ("A" in exports) return "A";
  if ("Ay" in exports) return "Ay";
  if (exports["__esModule"] === true && "default" in exports) return "default";
  return undefined;
}

export function makeException(): Error {
  return new Error("Module search failed!");
}
