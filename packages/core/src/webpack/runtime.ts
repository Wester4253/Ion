/**
 * The webpack runtime adapter.
 *
 * Wraps every factory arriving on the chunk stream so that, at first
 * execution, source patches are applied and rebuilt *before* Discord's code
 * runs, and afterwards the module's exports are announced to subscribers
 * (`waitFor`). It also captures `__webpack_require__` from the first factory
 * invocation, which powers cache-based discovery.
 *
 * Failure policy (hard requirement): a patch whose rebuilt code eval cannot
 * compile, or a patched factory that throws at runtime, logs an error naming
 * the plugin and falls back to the original factory. The client keeps
 * working; the notice tells you exactly what broke.
 */

import type { Logger } from "../logging";
import type { PatchRegistry, RebuildResult } from "../patches";
import type { ModuleFactory, WebpackRequire } from "./types";

export type ModuleListener = (exports: unknown, id: PropertyKey) => void;

export interface WebpackRuntimeOptions {
  readonly registry: PatchRegistry;
  readonly logger: Logger;
}

export interface WebpackRuntime {
  /**
   * Original (unwrapped) factories seen on the chunk stream, keyed by id.
   * Discord runs several bundler runtimes that share one chunk global, so
   * one id may legitimately map to factories from different runtimes.
   */
  readonly factories: ReadonlyMap<PropertyKey, readonly ModuleFactory[]>;
  /**
   * Every distinct `__webpack_require__` instance seen in factory calls.
   * Discord's page has one per bundler runtime, each with its own module
   * cache; discovery must search all of them.
   */
  getRequires(): readonly WebpackRequire[];
  /** Wrap every factory of an incoming chunk's modules object, in place. */
  readonly wrapChunkModules: (modules: Record<string, ModuleFactory>) => void;
  /** Subscribe to finished modules; returns an unsubscribe function. */
  onModule(listener: ModuleListener): () => void;
}

export function isWebpackRequire(value: unknown): value is WebpackRequire {
  if (typeof value !== "function") return false;
  const candidate = value as { c?: unknown; m?: unknown };
  return candidate.c != null && candidate.m != null;
}

function rebuildFactory(moduleId: PropertyKey, code: string): RebuildResult {
  try {
    // Discord's CSP ships 'unsafe-eval'; this is also how the upstream mods
    // rebuild patched factories (no-eval is intentionally not enabled here).
    // The sourceURL keeps them readable in devtools.
    const factory: unknown = (0, eval)(
      `${code}\n//# sourceURL=ion://webpack/${String(moduleId)}.js`,
    );
    if (typeof factory !== "function")
      return { ok: false, error: "rebuilt value is not a function" };
    return { ok: true, factory };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function createWebpackRuntime(options: WebpackRuntimeOptions): WebpackRuntime {
  const { registry, logger } = options;

  const factories = new Map<PropertyKey, ModuleFactory[]>();
  const wrappedFactories = new WeakSet<ModuleFactory>();
  // Patch decision per factory object: the patched replacement to run, or
  // the original when no patch applied. Keyed by the factory itself (not its
  // id) because ids collide across runtimes while shared chunks reuse one
  // factory object in several registries.
  const decisions = new WeakMap<ModuleFactory, ModuleFactory>();
  const requires: WebpackRequire[] = [];
  const listeners = new Set<ModuleListener>();

  function notify(moduleExports: unknown, id: PropertyKey): void {
    for (const listener of listeners) {
      try {
        listener(moduleExports, id);
      } catch (error) {
        logger.error(`a module listener errored for module ${String(id)}`, error);
      }
    }
  }

  function runPatches(id: PropertyKey, original: ModuleFactory): ModuleFactory | undefined {
    if (registry.size === 0) return undefined;

    const outcome = registry.applyTo(String(original), {
      moduleId: String(id),
      rebuild: (code) => rebuildFactory(id, code),
    });

    for (const notice of outcome.notices) {
      const line = `patch by ${notice.plugin}: ${notice.message}`;
      if (notice.level === "error") logger.error(line);
      else logger.warn(line);
    }

    if (outcome.patchedBy.length > 0) {
      logger.info(`patched module ${String(id)} by ${outcome.patchedBy.join(", ")}`);
    }

    if (outcome.factory === undefined || typeof outcome.factory !== "function") return undefined;
    return outcome.factory as ModuleFactory;
  }

  function wrapFactory(id: PropertyKey, original: ModuleFactory): ModuleFactory {
    return new Proxy(original, {
      apply(target, thisArg, args) {
        // ProxyHandler types `args` as any; narrow it once at the boundary.
        const factoryArgs = args as unknown[];
        const requireArg = factoryArgs[2];
        if (isWebpackRequire(requireArg) && !requires.includes(requireArg)) {
          requires.push(requireArg);
        }

        let running = decisions.get(target);
        if (!running) {
          running = runPatches(id, target) ?? target;
          decisions.set(target, running);
        }

        let result: unknown;
        try {
          result = Reflect.apply(running, thisArg, factoryArgs);
        } catch (error) {
          if (running === target) throw error;
          logger.error(
            `patched factory for module ${String(id)} threw, running the original`,
            error,
          );
          result = Reflect.apply(target, thisArg, factoryArgs);
        }

        const module = factoryArgs[0];
        if (module != null && typeof module === "object" && "exports" in module) {
          const exports = module.exports;
          if (exports != null) notify(exports, id);
        }

        return result;
      },
      get(target, property) {
        // Source lookups (findByCode, search) must see the original text.
        if (property === "toString") return Function.prototype.toString.bind(target);
        return Reflect.get(target, property) as unknown;
      },
    });
  }

  return {
    factories,
    getRequires: () => requires,
    onModule(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    wrapChunkModules(modules) {
      for (const id of Object.keys(modules)) {
        const factory = modules[id];
        // Failed chunk deliveries can carry non-function values; skip them.
        if (typeof factory !== "function") continue;
        // The push chain hands the same chunk past several entries, so a
        // factory may arrive already wrapped — wrapping twice would nest
        // proxies and shadow the original for source search.
        if (wrappedFactories.has(factory)) continue;
        const wrapped = wrapFactory(id, factory);
        wrappedFactories.add(wrapped);
        const existing = factories.get(id);
        if (existing) existing.push(factory);
        else factories.set(id, [factory]);
        modules[id] = wrapped;
      }
    },
  };
}
