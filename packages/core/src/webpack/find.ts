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

    if (filter(entry.exports)) return { id, exports: entry.exports };

    if (options.topLevelOnly || typeof entry.exports !== "object") continue;
    for (const key in entry.exports) {
      try {
        const nested = (entry.exports as Record<string, unknown>)[key];
        if (nested != null && filter(nested)) return { id, exports: nested };
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

    if (filter(entry.exports)) results.push(entry.exports);

    if (options.topLevelOnly || typeof entry.exports !== "object") continue;
    for (const key in entry.exports) {
      try {
        const nested = (entry.exports as Record<string, unknown>)[key];
        if (nested != null && filter(nested)) results.push(nested);
      } catch {
        continue;
      }
    }
  }
  return results;
}
