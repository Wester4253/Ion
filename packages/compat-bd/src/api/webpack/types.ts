/**
 * Shared types for `BdApi.Webpack`. Shapes mirror BetterDiscord's typed
 * webpack surface (Apache-2.0, see THIRD_PARTY.md).
 */

/**
 * A webpack module record as filters see it. In Ion these are the live
 * entries of `__webpack_require__.c` (one per executed module) that the
 * core captured from Discord's bundler runtimes.
 */
export interface BdModule {
  readonly id: PropertyKey;
  readonly exports: unknown;
  readonly loaded?: boolean;
}

/**
 * A filter over a module's exports. Upstream filters also receive the
 * module record and its id (`bySource` needs the id to reach the factory),
 * so all three arguments are always passed.
 */
export type ModuleFilter = (exports: unknown, module: BdModule, id: PropertyKey) => unknown;

/** A filter over a single exported value (upstream's ExportedOnlyFilter). */
export type ExportedOnlyFilter = (exports: unknown) => unknown;

export interface SearchOptions {
  /** When a nested export matched, return the full exports instead (default true). */
  defaultExport?: boolean;
  /** Also try every key of the exports object. */
  searchExports?: boolean;
  /** Also try the module's default-export key (`A`/`Ay`/`default`) (default true). */
  searchDefault?: boolean;
  /** Return the module record instead of its exports. */
  raw?: boolean;
  /** Return `[holder, key]` for the matched export. */
  withKey?: boolean;
  /** Throw `"Module search failed!"` on a miss instead of returning undefined. */
  fatal?: boolean;
  /** Rename matching exports through per-key filters (live get/set binding). */
  map?: Record<string, ExportedOnlyFilter>;
}

export interface WebpackOptions extends SearchOptions {
  /** `false` makes the lookup return every match. */
  first?: boolean;
}

export interface LazyOptions extends SearchOptions {
  /** Abort the wait; the promise then resolves undefined (or rejects when fatal). */
  signal?: AbortSignal;
}

export type ProxyOptions = SearchOptions;

export interface WithKeyOptions extends SearchOptions {
  target?: unknown;
}

export interface BulkQueries extends SearchOptions {
  filter: ModuleFilter;
  /** Collect every match for this query instead of the first. */
  all?: boolean;
}

/** Upstream's mangled-search filter argument. */
export type MangledFilter = ModuleFilter | string | RegExp | readonly (string | RegExp)[] | number;
