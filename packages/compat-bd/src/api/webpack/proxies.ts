/**
 * The lazy proxies behind `BdApi.Webpack`: `Stores`, `modules`, `getProxy`
 * and `getMangledProxy`. Ports of BetterDiscord's
 * src/betterdiscord/webpack/require.ts and the resolve-on-first-access half
 * of src/betterdiscord/common/utils/cache.ts (Apache-2.0, see
 * THIRD_PARTY.md).
 *
 * Ion resolves each lazy proxy exactly once — upstream's call limits and
 * non-Object refetch loop are omitted because a miss there can only be a
 * retry of the same deterministic search.
 */

import { discovery } from "../../host";
import { flux, getMangled, getModule, getStore } from "./search";
import type {
  ExportedOnlyFilter,
  MangledFilter,
  ModuleFilter,
  ProxyOptions,
  SearchOptions,
} from "./types";

/**
 * Proxy that runs `resolve()` on the first trap and forwards every trap to
 * the result. The proxy target is a function so the proxy stays callable
 * when the resolved value is a function, with `prototype`/`ownKeys`
 * adjusted to satisfy the engine's proxy invariants for that target.
 */
export function lazyProxy<T extends object>(resolve: () => T): T {
  let resolved: T | undefined;
  const target = (): T => (resolved ??= resolve());

  const proxyTarget = function () {
    // Never invoked directly: the `apply` trap forwards to the resolved value.
  };
  const handler: ProxyHandler<typeof proxyTarget> = {
    get: (_self, property, receiver) => {
      if (property === "prototype") {
        return (target() as { prototype?: unknown }).prototype ?? Function.prototype;
      }
      return Reflect.get(target(), property, receiver);
    },
    set: (_self, property, value, receiver) => Reflect.set(target(), property, value, receiver),
    has: (_self, property) => Reflect.has(target(), property),
    deleteProperty: (_self, property) => Reflect.deleteProperty(target(), property),
    defineProperty: (_self, property, descriptor) =>
      Reflect.defineProperty(target(), property, descriptor),
    getOwnPropertyDescriptor: (_self, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(target(), property);
      if (descriptor !== undefined) return descriptor;
      // The function proxy target's own `prototype` is non-configurable, so
      // the trap must keep reporting it even when the resolved value (a
      // plain object) has none — otherwise the engine throws a proxy
      // invariant TypeError.
      if (property === "prototype")
        return Object.getOwnPropertyDescriptor(proxyTarget, "prototype");
      return undefined;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(target()),
    setPrototypeOf: (_self, proto) => Reflect.setPrototypeOf(target(), proto),
    isExtensible: () => Reflect.isExtensible(target()),
    preventExtensions: () => Reflect.preventExtensions(target()),
    ownKeys: () => {
      const keys = Reflect.ownKeys(target());
      if (!keys.includes("prototype")) keys.push("prototype");
      return keys;
    },
    apply: (_self, thisArg, args) =>
      Reflect.apply(target() as unknown as (...argumentList: unknown[]) => unknown, thisArg, args),
    construct: (_self, args, newTarget) =>
      Reflect.construct(
        target() as new (...argumentList: unknown[]) => unknown,
        args,
        newTarget,
      ) as object,
  };
  return new Proxy(proxyTarget, handler) as unknown as T;
}

/** BD's `getProxy`: lazy, and fatal on first access when the module never showed up. */
export function getProxy(filter: ModuleFilter, options: ProxyOptions = {}): unknown {
  return lazyProxy<Record<string, unknown>>(
    () => getModule(filter, { ...options, fatal: true }) as Record<string, unknown>,
  );
}

/** Deprecated upstream twin of `getMangled` that resolves lazily. */
export function getMangledProxy<T extends object>(
  filter: MangledFilter,
  mangled: Record<keyof T, ExportedOnlyFilter>,
  options: SearchOptions = {},
): T {
  return lazyProxy<T>(() => getMangled<T>(filter, mangled, { ...options, fatal: true }));
}

/** Every Flux store, addressed by its registered name. */
export const Stores = new Proxy<Record<string, unknown>>(
  {},
  {
    ownKeys: () => {
      const registry = flux();
      if (!registry) return [];
      const names = registry.Store.getAll().map(
        (store) => (store as { getName?: () => string } | null | undefined)?.getName?.() ?? "",
      );
      return [...new Set(names)].filter((name) => name.length > 0);
    },
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    get: (target, property) => {
      if (typeof property === "symbol") return undefined;
      if (target[property] === undefined) target[property] = getStore(property);
      return target[property];
    },
    set: () => {
      throw new Error("[WebpackModules~Stores] Setting stores is not allowed.");
    },
  },
);

/** Module factories by id, as upstream's `Webpack.modules` exposes them. */
export const modules = new Proxy<Record<PropertyKey, unknown>>(
  {},
  {
    ownKeys: () => {
      const keys = new Set<string>();
      for (const webpackRequire of discovery().getRequires()) {
        for (const key in webpackRequire.m) keys.add(key);
      }
      return [...keys];
    },
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    get: (_target, property) => {
      if (typeof property === "symbol") return undefined;
      for (const webpackRequire of discovery().getRequires()) {
        const factory = webpackRequire.m[property];
        if (factory !== undefined) return factory;
      }
      return undefined;
    },
    set: () => {
      throw new Error("[WebpackModules~modules] Setting modules is not allowed.");
    },
  },
);
