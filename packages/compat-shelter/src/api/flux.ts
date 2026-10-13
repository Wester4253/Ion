/**
 * `shelter.flux` — the Flux surface Shelter plugins subscribe through.
 *
 * Upstream discovers Discord's dispatcher and stores by patching
 * `Array.prototype.push` and watching Discord push them into an array, then
 * keeps a registry built up over time. Ion already owns module discovery,
 * so the same public surface is produced from it: the dispatcher is looked
 * up by its exported props, and `stores` resolves a store by its
 * `getName()` the moment a plugin touches it, which means a store Discord
 * has not evaluated yet resolves as soon as it loads instead of being
 * absent forever. Nothing is patched in order to discover anything.
 *
 * The public shape is upstream's `without(...)` result: `dispatcher`,
 * `stores`, `storesFlat`, `awaitStore`, `intercept`. Intercept semantics —
 * one dispatcher interceptor fanning out to every subscriber, handling
 * upstream's legacy `[modified, shouldDrop]` array return alongside the
 * current nullish/falsy/object form — are reproduced exactly, because a
 * plugin returning the wrong shape must not silently change what it meant.
 *
 * (uwu/shelter is CC0-1.0; see THIRD_PARTY.md.)
 */

import type { IonDiscoveryApi } from "@ion/core";

/** A dispatcher event, modified in place by interceptors. */
export type DispatchPayload = Record<string, unknown>;

/** What an interceptor returns; see {@link FluxSurface.intercept}. */
export type Interceptor = (payload: DispatchPayload) => unknown;

/** The subset of Discord's FluxDispatcher this surface uses. */
export interface Dispatcher {
  dispatch(payload: DispatchPayload): Promise<void>;
  subscribe(type: string, callback: (payload: DispatchPayload) => void): unknown;
  unsubscribe(type: string, callback: (payload: DispatchPayload) => void): unknown;
  /** Installed once, at API build; upstream reads the same private field. */
  _interceptors?: unknown[];
  [key: string]: unknown;
}

function isDispatcher(value: unknown): value is Dispatcher {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Dispatcher>;
  return typeof candidate.dispatch === "function" && typeof candidate.subscribe === "function";
}

export interface FluxSurface {
  readonly dispatcher: Dispatcher;
  readonly stores: Record<string, unknown>;
  readonly storesFlat: Record<string, unknown>;
  awaitStore(name: string, awaitInit?: boolean): Promise<unknown>;
  intercept(callback: Interceptor): () => void;
}

/**
 * The store registry plugins read: a lazy name → store map a plugin may
 * also write, as upstream's plain object allows.
 */
function createStores(discovery: IonDiscoveryApi): Record<string, unknown> {
  const assigned: Record<string, unknown> = {};
  const resolved = new Map<string, unknown>();

  return new Proxy(assigned, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        // `Reflect.get` types itself as `any`; widen before returning so a
        // symbol-keyed read stays `unknown` at this boundary.
        const reflected: unknown = Reflect.get(target, property, receiver);
        return reflected;
      }
      if (Object.hasOwn(target, property)) return target[property];

      const cached = resolved.get(property);
      if (cached !== undefined) return cached;

      // `find` never warns on a miss, so probing a store Discord has not
      // evaluated yet stays quiet and retries on the next access.
      const found = discovery.find(discovery.filters.byStoreName(property));
      if (found !== undefined && found !== null) resolved.set(property, found);
      return found ?? undefined;
    },
    set(target, property, value, receiver) {
      if (typeof property === "string") resolved.delete(property);
      return Reflect.set(target, property, value, receiver);
    },
    deleteProperty(target, property) {
      if (typeof property === "string") resolved.delete(property);
      return Reflect.deleteProperty(target, property);
    },
  });
}

/**
 * Waits until a store exists and (like upstream) until it has finished
 * initializing. The `_isInitialized` setter swap is upstream's: it resolves
 * the moment Discord's own store flips the flag, without polling.
 */
async function awaitStoreInit(store: Record<string, unknown>): Promise<void> {
  if (store["_isInitialized"] === true) return;

  await new Promise<void>((resolve) => {
    let initialized = false;
    Object.defineProperty(store, "_isInitialized", {
      configurable: true,
      get: () => initialized,
      set(value: unknown) {
        initialized = value === true;
        if (initialized) resolve();
      },
    });
  });
}

/** Resolves a store Discord has not evaluated yet, through discovery's waiter. */
function awaitStoreArrival(
  discovery: IonDiscoveryApi,
  name: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    discovery.waitFor(discovery.filters.byStoreName(name), (found) => {
      resolve(found as Record<string, unknown>);
    });
  });
}

/** Builds `shelter.flux` around one resolved dispatcher. */
export function createFluxSurface(discovery: IonDiscoveryApi, dispatcher: Dispatcher): FluxSurface {
  const stores = createStores(discovery);
  const interceptors: Interceptor[] = [];

  // One dispatcher interceptor for every subscriber, installed before any
  // other code can register one — so a payload is rewritten at most once.
  const existing = dispatcher._interceptors ?? [];
  dispatcher._interceptors = existing;
  existing.unshift((payload: DispatchPayload) => {
    const replacePayload = (replacement: DispatchPayload): void => {
      // `PropertyKey` rather than `string`: a payload can carry symbol keys,
      // and upstream clears all of them before applying the replacement.
      const target = payload as Record<PropertyKey, unknown>;
      for (const key of Reflect.ownKeys(target)) Reflect.deleteProperty(target, key);
      Object.assign(target, replacement);
    };

    let blocked = false;
    for (const interceptor of interceptors) {
      const result = interceptor(payload);
      if (Array.isArray(result)) {
        // Legacy return type: [modified, shouldDrop].
        if (result[1] === true) blocked = true;
        replacePayload(result[0] as DispatchPayload);
      } else if (result === undefined || result === null) continue;
      else if (typeof result === "object") replacePayload(result as DispatchPayload);
      else blocked = true;
    }
    return blocked;
  });

  return {
    dispatcher,
    stores,
    storesFlat: new Proxy(stores, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (!Array.isArray(value)) return value;
        // `Array.isArray` types the collection as `any[]`; re-widen it, since
        // whatever this trap returns goes straight to plugin code.
        const elements: unknown[] = value;
        return elements[0];
      },
      set() {
        throw new Error("do not try to mutate storesFlat");
      },
      deleteProperty() {
        throw new Error("do not try to mutate storesFlat");
      },
    }),
    async awaitStore(name: string, awaitInit = true): Promise<unknown> {
      const existingStore = stores[name];
      const store =
        existingStore === undefined || existingStore === null
          ? await awaitStoreArrival(discovery, name)
          : (existingStore as Record<string, unknown>);
      if (awaitInit) await awaitStoreInit(store);
      return store;
    },
    intercept(callback: Interceptor): () => void {
      interceptors.push(callback);
      return () => {
        const index = interceptors.indexOf(callback);
        if (index !== -1) interceptors.splice(index, 1);
      };
    },
  };
}

/** Finds Discord's FluxDispatcher; throws with the props it was sought by. */
export function findDispatcher(discovery: IonDiscoveryApi): Dispatcher {
  const found = discovery.findByProps("dispatch", "subscribe");
  if (!isDispatcher(found)) {
    throw new Error(
      "shelter.flux could not find Discord's FluxDispatcher (a module exposing dispatch + subscribe)",
    );
  }
  return found;
}
