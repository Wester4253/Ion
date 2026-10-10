/**
 * Structural types for Discord's webpack runtime, derived from the shapes
 * Vencord/Equicord document for the same objects (studied, not copied).
 */

/** One entry of `webpackRequire.c` (the evaluated-module cache). */
export interface CacheEntry {
  readonly id: PropertyKey;
  readonly loaded?: boolean;
  readonly exports: unknown;
}

/** The module object handed to every factory. */
export interface WebpackModule {
  readonly id: PropertyKey;
  exports: unknown;
  readonly loaded?: boolean;
}

/**
 * A module factory: `(module, exports, require) => void`. Discord's are
 * minified functions or arrows; Ion only ever rebuilds them via
 * source-text patches.
 */
export type ModuleFactory = (
  module: WebpackModule,
  exports: unknown,
  require: WebpackRequire,
) => unknown;

/** The `__webpack_require__` instance Discord passes to every factory. */
export interface WebpackRequire {
  (id: PropertyKey): unknown;
  readonly c: Record<PropertyKey, CacheEntry | undefined>;
  readonly m: Record<PropertyKey, ModuleFactory | undefined>;
}
