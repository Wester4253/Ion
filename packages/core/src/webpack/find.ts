/**
 * Searching a webpack module cache. Pure functions over an injected cache
 * object so they are unit-testable without Discord.
 */

import type { ModuleFilter } from "./filters";
import type { CacheEntry } from "./types";

export type ModuleCache = Record<PropertyKey, CacheEntry | undefined>;

export interface FindOptions {
  /** Do not descend into the nested exports of a matched module. */
  readonly topLevelOnly?: boolean;
}

export interface FoundModule {
  readonly id: PropertyKey;
  readonly exports: unknown;
}

/**
 * Whether a module's exports IS the page's global object. Core-js's global
 * shim registers `window` itself as a webpack module, so a nested scan over
 * it reads arbitrary page properties: getters run their side effects
 * (Vencord's console shortcuts force component lazies on access) and the
 * values matched are page objects, not webpack exports — a defaulting
 * Proxy cached on `window` re-matched every scan that touched it. The
 * top-level filter still runs on such a module; only the descent into the
 * page is skipped.
 */
export function isGlobalObject(value: unknown): boolean {
  return typeof globalThis !== "undefined" && value === globalThis;
}

/** A filter that throws (a Proxy trap, an uninitialized export) is a miss. */
export function matches(filter: ModuleFilter, value: unknown, id: PropertyKey): boolean {
  try {
    return filter(value, id);
  } catch {
    return false;
  }
}

/**
 * First loaded module (or nested export) matching the filter.
 *
 * Skipping unloaded/null entries and swallowing throwing getters mirrors
 * upstream: a module with a poisoned getter must not break discovery.
 */
export function findInCache(
  cache: ModuleCache,
  filter: ModuleFilter,
  options: FindOptions = {},
): FoundModule | undefined {
  for (const id in cache) {
    const entry = cache[id];
    if (!entry?.loaded || entry.exports == null) continue;

    if (matches(filter, entry.exports, id)) return { id, exports: entry.exports };

    if (options.topLevelOnly || typeof entry.exports !== "object") continue;
    if (isGlobalObject(entry.exports)) continue;
    for (const key in entry.exports) {
      try {
        const nested = (entry.exports as Record<string, unknown>)[key];
        if (nested != null && matches(filter, nested, id)) return { id, exports: nested };
      } catch {
        // A throwing getter (circular init, defensive getters) is a miss,
        // not a failure of the search.
        continue;
      }
    }
  }
  return undefined;
}

/** Every loaded module (and nested export) matching the filter. */
export function findAllInCache(
  cache: ModuleCache,
  filter: ModuleFilter,
  options: FindOptions = {},
): unknown[] {
  const results: unknown[] = [];
  for (const id in cache) {
    const entry = cache[id];
    if (!entry?.loaded || entry.exports == null) continue;

    if (matches(filter, entry.exports, id)) results.push(entry.exports);

    if (options.topLevelOnly || typeof entry.exports !== "object") continue;
    if (isGlobalObject(entry.exports)) continue;
    for (const key in entry.exports) {
      try {
        const nested = (entry.exports as Record<string, unknown>)[key];
        if (nested != null && matches(filter, nested, id)) results.push(nested);
      } catch {
        continue;
      }
    }
  }
  return results;
}
