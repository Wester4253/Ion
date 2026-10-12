/**
 * BetterDiscord's module search — a behavioral port of
 * src/betterdiscord/webpack/searching.ts and utilities.ts (Apache-2.0, see
 * THIRD_PARTY.md), running over the module caches the Ion core captured.
 *
 * Upstream walks a single `webpackRequire.c`; Discord runs several
 * bundler runtimes on one page, so this walks every captured cache in
 * capture order — the same modules upstream would see with one runtime,
 * plus the ones that runtime split off.
 *
 * Upstream's `cacheId`/`firstId` per-stack-module-caches are omitted: they
 * are pure memoization of this same scan (upstream re-verifies the filter
 * through its own fallback), so results are identical without them.
 */

import { discovery } from "../../host";
import {
  bySource,
  byStoreName,
  getDefaultKey,
  makeException,
  shouldSkipModule,
  wrapModuleFilter,
} from "./filters";
import { mapObject } from "./mapObject";
import type {
  BdModule,
  BulkQueries,
  ExportedOnlyFilter,
  LazyOptions,
  MangledFilter,
  ModuleFilter,
  SearchOptions,
} from "./types";

/** Every module record in every captured cache, in capture order. */
export function* everyModule(): Generator<BdModule> {
  for (const webpackRequire of discovery().getRequires()) {
    const cache = webpackRequire.c;
    for (const key in cache) {
      const entry = cache[key];
      if (entry !== undefined) yield entry;
    }
  }
}

/**
 * BD's single-module match: exports first, then — depending on options —
 * the default-export key or every key, with raw/withKey/map shaping the
 * returned value. Returns undefined when nothing matched.
 */
export function getMatched(
  module: BdModule,
  filter: ModuleFilter,
  options: SearchOptions,
): unknown {
  const {
    defaultExport = true,
    searchExports = false,
    searchDefault = true,
    raw = false,
    withKey = false,
    map,
  } = options;

  if (shouldSkipModule(module.exports)) return undefined;

  if (filter(module.exports, module, module.id)) {
    if (map) return mapObject(module.exports as object, map);
    if (raw) return module;
    if (withKey) return [module, "exports"];
    return module.exports;
  }

  if (!searchExports && !searchDefault) return undefined;

  let defaultKey: string | undefined;
  const searchKeys: string[] = [];
  if (searchExports) {
    searchKeys.push(...Object.keys(module.exports as object));
  } else if (searchDefault && (defaultKey = getDefaultKey(module))) {
    searchKeys.push(defaultKey);
  }

  const values = module.exports as Record<string, unknown>;
  for (const key of searchKeys) {
    const exported = values[key];
    if (shouldSkipModule(exported)) continue;
    if (filter(exported, module, module.id)) {
      if (map) return mapObject((raw ? module.exports : exported) as object, map);
      if (raw) return module;
      if (!defaultExport && defaultKey === key)
        return withKey ? [module, "exports"] : module.exports;
      return withKey ? [module.exports, key] : exported;
    }
  }
  return undefined;
}

function scanFirst(moduleFilter: ModuleFilter, options: SearchOptions): unknown {
  for (const module of everyModule()) {
    const matched = getMatched(module, moduleFilter, options);
    if (matched) return matched;
  }
  return undefined;
}

export function getModule(filter: ModuleFilter, options: SearchOptions = {}): unknown {
  const found = scanFirst(wrapModuleFilter(filter), options);
  if (found === undefined) {
    if (options.fatal) throw makeException();
    return undefined;
  }
  return found;
}

/** Every match across every module (upstream's `first: false` path). */
export function getAllModules(filter: ModuleFilter, options: SearchOptions = {}): unknown[] {
  const {
    defaultExport = true,
    searchExports = false,
    searchDefault = true,
    raw = false,
    withKey = false,
    map,
  } = options;
  const wrapped = wrapModuleFilter(filter);
  const results: unknown[] = [];

  for (const module of everyModule()) {
    if (shouldSkipModule(module.exports)) continue;

    if (wrapped(module.exports, module, module.id)) {
      if (map) results.push(mapObject(module.exports as object, map));
      else results.push(raw ? module : withKey ? [module, "exports"] : module.exports);
    }

    if (!searchExports && !searchDefault) continue;

    let defaultKey: string | undefined;
    const searchKeys: string[] = [];
    if (searchExports) {
      searchKeys.push(...Object.keys(module.exports as object));
    } else if (searchDefault && (defaultKey = getDefaultKey(module))) {
      searchKeys.push(defaultKey);
    }

    const values = module.exports as Record<string, unknown>;
    for (const key of searchKeys) {
      const exported = values[key];
      if (shouldSkipModule(exported)) continue;
      if (wrapped(exported, module, module.id)) {
        if (map) results.push(mapObject((raw ? module.exports : exported) as object, map));
        else if (!defaultExport && defaultKey === key) {
          results.push(withKey ? [module, "exports"] : module.exports);
        } else results.push(raw ? module : withKey ? [module.exports, key] : exported);
      }
    }
  }

  return results;
}

export function getById(id: PropertyKey, options: SearchOptions = {}): unknown {
  const { raw = false, fatal = false } = options;
  for (const webpackRequire of discovery().getRequires()) {
    const entry = webpackRequire.c[id];
    if (entry === undefined) continue;
    if (!shouldSkipModule(entry.exports)) return raw ? entry : entry.exports;
  }
  if (fatal) throw makeException();
  return undefined;
}

/** Discord's Flux store registry, found the way upstream finds it. */
export function flux(): { Store: { getAll(): unknown[] } } | undefined {
  return getModule((exports) => {
    const candidate = exports as { Store?: { getAll?: unknown } | null } | null | undefined;
    return Boolean(candidate?.Store?.getAll);
  }) as { Store: { getAll(): unknown[] } } | undefined;
}

function isIndexableLike(value: unknown): boolean {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

export function getStore(name: string): unknown {
  const registry = flux();
  if (!registry) return getModule(byStoreName(name));
  return registry.Store.getAll().find(
    (store) => (store as { getName?: () => string } | null | undefined)?.getName?.() === name,
  );
}

/** BD's deprecated generator: yields the export holder, then the matching key. */
export function* getWithKey(
  filter: ExportedOnlyFilter,
  options: SearchOptions & { target?: unknown } = {},
): Generator<unknown, void, unknown> {
  const { target = null, ...rest } = options;
  const found =
    target ??
    getModule((exports) => Object.values(exports as object).some((value) => filter(value)), rest);
  yield found;
  yield found && Object.keys(found).find((key) => filter((found as Record<string, unknown>)[key]));
}

function normalizeMangledFilter(filter: MangledFilter): ModuleFilter {
  if (typeof filter === "string" || filter instanceof RegExp) return bySource(filter);
  if (Array.isArray(filter)) return bySource(...(filter as (string | RegExp)[]));
  return filter as ModuleFilter;
}

export function getMangled<T extends object>(
  filter: MangledFilter,
  mangled: Record<keyof T, ExportedOnlyFilter>,
  options: SearchOptions = {},
): T {
  const found =
    typeof filter === "number"
      ? getById(filter, options)
      : getModule(normalizeMangledFilter(filter), options);
  if (!found) return {} as T;
  const target = options.raw ? (found as BdModule).exports : found;
  return mapObject(target as object, mangled);
}

/**
 * BD's `getBulk`: one cache pass fills every query. Queries marked `all`
 * collect every match; the rest resolve to their first and stop being
 * searched once filled.
 */
export function getBulk(queries: readonly BulkQueries[]): unknown[] {
  const wrapped = queries.map((query) => ({ ...query, filter: wrapModuleFilter(query.filter) }));
  // Sparse, exactly like upstream: an unfilled index reads back as a hole.
  const results = new Array<unknown>(wrapped.length);
  const filled = wrapped.map(() => false);
  let pending = wrapped.filter((query) => !query.all).length;

  scan: for (const module of everyModule()) {
    if (shouldSkipModule(module.exports)) continue;
    for (let index = 0; index < wrapped.length; index++) {
      const query = wrapped[index];
      if (query === undefined) continue;
      if (!query.all && filled[index]) continue;
      const matched = getMatched(module, query.filter, query);
      if (!matched) continue;
      if (!query.all) {
        filled[index] = true;
        results[index] = matched;
        pending--;
        if (pending === 0) break scan;
      } else {
        const bucket = results[index];
        if (Array.isArray(bucket)) bucket.push(matched);
        else results[index] = [matched];
      }
    }
  }

  for (let index = 0; index < wrapped.length; index++) {
    const query = wrapped[index];
    if (query === undefined) continue;
    const exists = index in results;
    if (query.map) {
      if (!exists) {
        if (query.fatal) throw makeException();
        results[index] = {};
      }
    } else if (query.all) {
      if ((!exists || (results[index] as unknown[]).length === 0) && query.fatal)
        throw makeException();
      if (!exists) results[index] = [];
    } else if (!exists && query.fatal) {
      throw makeException();
    }
  }

  return results;
}

export function getBulkKeyed<T extends object>(queries: Record<keyof T, BulkQueries>): T {
  const keys = Object.keys(queries) as (keyof T)[];
  const found = getBulk(keys.map((key) => queries[key]));
  const keyed = Object.create(null) as Record<string, unknown>;
  keys.forEach((key, index) => {
    keyed[key as string] = found[index];
  });
  return keyed as T;
}

/**
 * BD's `waitForModule`: search the existing cache immediately, then resolve
 * as soon as a future module matches. The probe handed to Ion's `waitFor`
 * re-runs full BD match semantics (default-key descent, raw/withKey, …)
 * against a reverse lookup from exports back to their module record, so
 * filters that use the module record or id (like `bySource`) work for
 * modules that finish loading later.
 */
export function waitForModule<T>(
  filter: ModuleFilter,
  options: LazyOptions = {},
): Promise<T | undefined> {
  const { signal, fatal = false } = options;
  if (signal?.aborted) return fatal ? Promise.reject(makeException()) : Promise.resolve(undefined);

  const wrapped = wrapModuleFilter(filter);
  const immediate = scanFirst(wrapped, options);
  if (immediate !== undefined) return Promise.resolve(immediate as T);

  // Reverse index of exports → module record: O(cache) once, O(1) per probe,
  // with a slow-path rescan for modules that finish loading later.
  const index = new Map<unknown, BdModule>();
  for (const module of everyModule()) {
    if (module.exports != null) index.set(module.exports, module);
  }
  const entryFor = (exports: unknown): BdModule | undefined => {
    if (exports == null || !isIndexableLike(exports)) return undefined;
    const hit = index.get(exports);
    if (hit) return hit;
    for (const module of everyModule()) {
      if (module.exports === exports) {
        index.set(exports, module);
        return module;
      }
    }
    return undefined;
  };

  return new Promise<T | undefined>((resolve, reject) => {
    let settled = false;
    const finish = (value: T | undefined): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
      if (fatal) reject(makeException());
      else resolve(undefined);
    };

    let matched: T | undefined;
    const unsubscribe = discovery().waitFor(
      (exports) => {
        const module = entryFor(exports);
        if (!module) return false;
        const found = getMatched(module, wrapped, options);
        if (!found) return false;
        matched = found as T;
        return true;
      },
      () => {
        finish(matched);
      },
    );

    signal?.addEventListener("abort", onAbort);
  });
}
