/**
 * `shelter.plugin.store`: a mutable, Solid-reactive plugin store.
 *
 * Why this exists. Upstream Shelter keeps each plugin's store in a mutable
 * valtio proxy, so `store.someFlag = value`, `store.keybinds ??= []` and
 * `store.list.push(x)` all work, and a settings component re-renders when the
 * plugin writes. Handing plugins Solid's `createStore` proxy instead is not
 * equivalent: in solid-js 1.6.16 that proxy's `set` trap does nothing but
 * `console.warn("Cannot mutate a Store directly")`. Every write is dropped,
 * so a plugin that seeds its own store and reads it back — `onLoad` →
 * `bootstrapStore()` → `for (const guildId of store.watchedGuilds)` — throws
 * `store.watchedGuilds is not iterable`, with nothing in the message naming
 * the real cause. That was reproduced in a unit probe (`store.probe.test.tsx`,
 * since deleted) and then moved here as a regression test.
 *
 * The fix routes writes through the setter that came with the store. Solid
 * keeps its own reactivity and array handling, and `unwrap` still describes
 * the whole tree for persistence — so this is a proxy *over* the store rather
 * than a second store, with no new dependency. The contract plugins rely on
 * (mutate, read, observe, persist) is what `createStore` already provides
 * once a write can reach its setter.
 *
 * Paths, not trees: each level of the returned proxy carries the key path
 * that got it there, so a write at any depth is applied as one
 * `setStore(...path, prop, value)` — `store.a.b[2].c = x` never becomes a
 * reassignment of `a`.
 */

import type { SetStoreFunction } from "solid-js/store";
import { createStore, unwrap } from "solid-js/store";

/** The store a plugin sees: a plain object it may mutate and read. */
export type PluginStore = Record<string, unknown>;

/** Applied with a key path plus a value; seen as a void call by this module. */
type Write = (...args: unknown[]) => void;

export interface StoreHandle {
  /** The mutable, reactive proxy a plugin's source is handed. */
  readonly store: PluginStore;
  /** Solid's own write function, for code that persists through it. */
  readonly write: SetStoreFunction<PluginStore>;
  /** Solid's plain-object view of everything persisted so far. */
  readonly snapshot: () => PluginStore;
}

/**
 * Containers are proxied by depth so deeper writes keep their path. Arrays
 * come first because they are iterable and still need proxy-level writes;
 * anything else iterable (Map, Set) is handed through untouched, since
 * mutating it does not go through the store either.
 */
function isContainer(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  return Array.isArray(value) || !(Symbol.iterator in value);
}

/** Wrap one level of a Solid store, remembering the path that reached it. */
function proxyAt(target: object, path: readonly (string | symbol)[], write: Write): object {
  return new Proxy(target, {
    get(base, property, receiver) {
      // Solid's own symbols ($RAW, $PROXY, $NODE) must reach the store
      // untouched: re-proxying them breaks `unwrap`, which every
      // synchronized write goes through. Nothing a plugin writes is reached
      // by a symbol key anyway.
      if (typeof property === "symbol") {
        return Reflect.get(base, property, receiver) as unknown;
      }
      const value: unknown = Reflect.get(base, property, receiver);
      // A container keeps being proxied so `store.a.b = x` is addressed by
      // path. Everything else — including methods, which keep their receiver
      // — is returned as Solid has it, tracked reads included.
      if (isContainer(value)) return proxyAt(value, [...path, property], write);
      return value;
    },
    set(_, property, value) {
      // A value written from another plugin's store would carry that store's
      // proxy; hand Solid the plain value instead of a foreign proxy.
      write(...[...path, property, unwrap(value as object)]);
      return true;
    },
    deleteProperty(_, property) {
      // Solid has no delete setter, so removing a key writes `undefined`.
      write(...[...path, property, undefined]);
      return true;
    },
  });
}

/**
 * Build one plugin's store from whatever was persisted last.
 *
 * An empty starting store still works: `store.key = value` with no preceding
 * write is addressed as a root-key write, which Solid applies.
 */
export function createPluginStore(initial: PluginStore): StoreHandle {
  const [store, setStore] = createStore<PluginStore>(initial);
  const write: Write = (...args) => {
    (setStore as unknown as Write)(...args);
  };
  return {
    store: proxyAt(store, [], write) as PluginStore,
    write: setStore,
    snapshot: () => unwrap(store),
  };
}
