/**
 * Webpack module discovery — Ion's public API surface for plugins and the
 * compat adapters.
 *
 * The lookups and their semantics mirror Vencord's public API (`findByProps`
 * and friends) because every Vencord/Equicord plugin is written against it.
 * Failed finds log a warning naming the lookup and its arguments and return
 * null — they never throw and never crash the client. Use the `*Lazy`
 * variants for modules that only exist after a chunk loads; they evaluate on
 * first access and retry.
 *
 * `initWebpack` must run at core boot (before Discord's scripts) so the
 * chunk hook sees every factory.
 */

import { proxyLazy } from "../lazy";
import { createLogger, type Logger } from "../logging";
import {
  canonicalizeMatch,
  PatchRegistry as Registry,
  type Patch,
  type PatchRegistry,
} from "../patches";
import type { IonWebpackStatus } from "../platform/shell";
import { filters, stringMatches, type CodeFilter, type ModuleFilter } from "./filters";
import { findAllInCache, findInCache, type FindOptions, type ModuleCache } from "./find";
import { installChunkHook, type ChunkHook } from "./hook";
import { createWebpackRuntime, type WebpackRuntime } from "./runtime";
import type { ModuleFactory } from "./types";

const logger: Logger = createLogger("webpack");

const registry: PatchRegistry = new Registry();
const runtime: WebpackRuntime = createWebpackRuntime({ registry, logger });
let hook: ChunkHook | undefined;

const storeCache = new Map<string, unknown>();

/**
 * Register source patches. Must happen before Discord evaluates its
 * modules — patches only affect factories that have not run yet, so plugins
 * register at core boot (the same rule upstream follows).
 */
export function registerPatches(...patches: readonly Patch[]): void {
  registry.add(...patches);
}

/**
 * Install the webpack chunk hook on `scope` (idempotent).
 * Called once by the core entry point, before any Discord script.
 */
export function initWebpack(
  scope: Record<string, unknown> = window as unknown as Record<string, unknown>,
): void {
  if (hook) return;
  hook = installChunkHook(scope, runtime.wrapChunkModules);
}

function everyCache(): ModuleCache[] {
  return runtime.getRequires().map((require) => require.c);
}

function requireFilter(filter: ModuleFilter): ModuleFilter {
  if (typeof filter !== "function")
    throw new TypeError(`webpack filter must be a function, got ${typeof filter}`);
  return filter;
}

function describeCode(code: CodeFilter): string {
  const clip = (value: string): string => (value.length > 60 ? `${value.slice(0, 57)}...` : value);
  return code
    .map((fragment) =>
      clip(typeof fragment === "string" ? JSON.stringify(fragment) : String(fragment)),
    )
    .join(", ");
}

/** First loaded module (or nested export) matching the filter, else undefined. */
export function find(filter: ModuleFilter, options?: FindOptions): unknown {
  const predicate = requireFilter(filter);
  for (const cache of everyCache()) {
    const found = findInCache(cache, predicate, options);
    if (found) return found.exports;
  }
  return undefined;
}

/** All loaded modules (and nested exports) matching the filter. */
export function findAll(filter: ModuleFilter, options?: FindOptions): unknown[] {
  const predicate = requireFilter(filter);
  const results: unknown[] = [];
  for (const cache of everyCache()) {
    results.push(...findAllInCache(cache, predicate, options));
  }
  return results;
}

/** First module exposing all the given properties; logs a warning on miss. */
export function findByProps(...props: string[]): unknown {
  const result = find(filters.byProps(...props));
  if (result == null) logger.warn(`findByProps found no module for: ${props.join(", ")}`);
  return result;
}

/** First function whose source contains all fragments; logs a warning on miss. */
export function findByCode(...code: CodeFilter): unknown {
  const result = find(filters.byCode(...code));
  if (result == null) logger.warn(`findByCode found no module for: ${describeCode(code)}`);
  return result;
}

/** Flux store by constructor displayName; logs a warning on miss. */
export function findStore(name: string): unknown {
  const cached = storeCache.get(name);
  if (cached !== undefined) return cached;

  const result = find(filters.byStoreName(name));
  if (result == null) {
    logger.warn(`findStore found no store named: ${name}`);
    return result;
  }
  storeCache.set(name, result);
  return result;
}

/** Id of the first module factory containing all fragments, else null. */
export function findModuleId(...code: CodeFilter): string | null {
  const fragments = code.map(canonicalizeMatch);
  for (const [id, list] of runtime.factories) {
    if (list.some((factory) => stringMatches(String(factory), fragments))) return String(id);
  }
  logger.warn(`findModuleId found no factory for: ${describeCode(code)}`);
  return null;
}

/** The first module factory containing all fragments, else null. */
export function findModuleFactory(...code: CodeFilter): ModuleFactory | null {
  const fragments = code.map(canonicalizeMatch);
  for (const list of runtime.factories.values()) {
    for (const factory of list) {
      if (stringMatches(String(factory), fragments)) return factory;
    }
  }
  logger.warn(`findModuleFactory found no factory for: ${describeCode(code)}`);
  return null;
}

/** Search factory sources; returns every matching id → factory (no warning). */
export function search(...code: CodeFilter): Record<string, ModuleFactory> {
  const fragments = code.map(canonicalizeMatch);
  const results: Record<string, ModuleFactory> = {};
  for (const [id, list] of runtime.factories) {
    for (const factory of list) {
      if (stringMatches(String(factory), fragments)) {
        results[String(id)] = factory;
        break;
      }
    }
  }
  return results;
}

function normalizeWaitFilter(filter: string | readonly string[] | ModuleFilter): ModuleFilter {
  if (typeof filter === "string") return filters.byProps(filter);
  if (typeof filter === "function") return filter;
  if (Array.isArray(filter)) return filters.byProps(...(filter as readonly string[]));
  throw new TypeError(
    `waitFor filter must be a string, string[], or function, got ${typeof filter}`,
  );
}

/**
 * Call `listener` with the first module matching `filter` — immediately if
 * it is already in the cache, otherwise as soon as it finishes executing.
 * Returns an unsubscribe function.
 */
export function waitFor(
  filter: string | readonly string[] | ModuleFilter,
  listener: (exports: unknown, id: PropertyKey) => void,
): () => void {
  const predicate = normalizeWaitFilter(filter);

  for (const cache of everyCache()) {
    const existing = findInCache(cache, predicate);
    if (existing) {
      listener(existing.exports, existing.id);
      return () => undefined;
    }
  }

  const unsubscribe = runtime.onModule((moduleExports, id) => {
    if (predicate(moduleExports)) {
      unsubscribe();
      listener(moduleExports, id);
      return;
    }
    if (typeof moduleExports !== "object") return;
    for (const key in moduleExports) {
      try {
        const nested = (moduleExports as Record<string, unknown>)[key];
        if (nested != null && predicate(nested)) {
          unsubscribe();
          listener(nested, id);
          return;
        }
      } catch {
        // Throwing getter: not a match, keep scanning.
        continue;
      }
    }
  });
  return unsubscribe;
}

export function findLazy(filter: ModuleFilter): unknown {
  return proxyLazy(() => find(filter));
}

export function findByPropsLazy(...props: string[]): unknown {
  return proxyLazy(() => findByProps(...props));
}

export function findByCodeLazy(...code: CodeFilter): unknown {
  return proxyLazy(() => findByCode(...code));
}

export function findStoreLazy(name: string): unknown {
  return proxyLazy(() => findStore(name));
}

/** Snapshot for the debug panel and the smoke report. */
export function probeHealth(): IonWebpackStatus {
  const caches = everyCache();
  const sampleProps = filters.byProps("getCurrentUser");
  const sampleStore = filters.byStoreName("UserStore");
  let cacheEntries = 0;
  let byProps = false;
  let store = false;
  for (const cache of caches) {
    cacheEntries += Object.keys(cache).length;
    if (!byProps) byProps = findInCache(cache, sampleProps) !== undefined;
    if (!store) store = findInCache(cache, sampleStore) !== undefined;
  }
  return {
    hooked: hook !== undefined,
    ready: caches.length > 0,
    factories: runtime.factories.size,
    cache: cacheEntries,
    byProps,
    store,
  };
}
