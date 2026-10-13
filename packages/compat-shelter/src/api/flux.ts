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

import { adapterLog } from "../logger";

/** A dispatcher event, modified in place by interceptors. */
export type DispatchPayload = Record<string, unknown>;

/** What an interceptor returns; see {@link FluxSurface.intercept}. */
export type Interceptor = (payload: DispatchPayload) => unknown;

/** The subset of Discord's FluxDispatcher this surface uses. */
export interface Dispatcher {
  dispatch(payload: DispatchPayload): Promise<void>;
  subscribe(type: string, callback: (payload: DispatchPayload) => void): unknown;
  unsubscribe(type: string, callback: (payload: DispatchPayload) => void): unknown;
  /** Discord's own installer, present on some builds. */
  addInterceptor?: (interceptor: Interceptor) => void;
  /**
   * The private registries. Containers, and the only reliable way to tell the
   * dispatcher apart from a module that merely exports the same props.
   */
  _actionHandlers?: unknown;
  _subscriptions?: unknown;
  /**
   * Upstream's private list, installed once at API build. `unknown` rather
   * than an array because its shape varies by build — see
   * {@link installInterceptor}, which is what reads it.
   */
  _interceptors?: unknown;
  [key: string]: unknown;
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

/**
 * A short name for whatever `_interceptors` currently holds, for the one log
 * line a non-standard build produces. `unknown` on purpose: the field is
 * private and its shape is exactly what has to be reported when it is not
 * what upstream expects.
 */
function interceptorShape(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object" && typeof value !== "function") return typeof value;
  const ctor: unknown = (value as { constructor?: unknown }).constructor;
  if (typeof ctor === "function" && typeof ctor.name === "string" && ctor.name.length > 0) {
    return ctor.name;
  }
  return typeof value;
}

/**
 * The result of {@link installInterceptor}: which shape it wrote through, or
 * why it could not. The reason is carried rather than logged once, so a plugin
 * that asks for `intercept` gets it too.
 */
export type InterceptorInstall =
  | { readonly ok: true; readonly via: "array" | "addInterceptor" }
  | { readonly ok: false; readonly reason: string };

/**
 * Installs the one fan-out interceptor and reports which path it took.
 *
 * Upstream reads `_interceptors` unconditionally and `unshift`s into it. On a
 * build where that field holds something else, the whole `window.shelter` build
 * died with `existing.unshift is not a function` — one dispatcher's private
 * field taking every staged plugin's verdict with it. So the shape is checked
 * first: the array upstream uses when it really is one, Discord's own
 * `addInterceptor` when it is not, and otherwise a *reported* refusal that
 * leaves the rest of the API usable — `shelter.flux.intercept` then throws by
 * name, carrying this reason, for the plugin that asked.
 *
 * `addInterceptor` with the field simply absent is a normal build and stays
 * quiet. A line is only logged when the field exists and holds something else,
 * so the one unusual case is the one that shows up in a run's evidence.
 */
export function installInterceptor(
  dispatcher: Dispatcher,
  handler: Interceptor,
): InterceptorInstall {
  const raw = dispatcher._interceptors;

  if (Array.isArray(raw)) {
    (raw as Interceptor[]).unshift(handler);
    return { ok: true, via: "array" };
  }

  if (typeof dispatcher.addInterceptor === "function") {
    const unusual = raw !== undefined && raw !== null;
    dispatcher.addInterceptor(handler);
    if (unusual) {
      adapterLog(
        "warn",
        "dispatcher interceptors",
        `installed through addInterceptor; _interceptors holds ${interceptorShape(raw)}`,
      );
    }
    return { ok: true, via: "addInterceptor" };
  }

  if (raw === undefined || raw === null) {
    // Upstream's `??=` path: no list yet, so this build has none to read.
    dispatcher._interceptors = [handler];
    return { ok: true, via: "array" };
  }

  const reason = `no dispatcher interceptor on this build: _interceptors holds ${interceptorShape(raw)} and there is no addInterceptor`;
  adapterLog("warn", "dispatcher interceptors", `refused: ${reason}`);
  return { ok: false, reason };
}

/** Why `dispatcher` and `intercept` are unavailable, when they are. */
const NO_DISPATCHER =
  "this build exposes no Discord FluxDispatcher " +
  "(a module exposing dispatch + subscribe beside its own private registries)";

/**
 * Builds `shelter.flux` around one resolved dispatcher.
 *
 * `stores`, `storesFlat`, and `awaitStore` come from discovery and work with
 * or without it. When the dispatcher is missing, the two members that need it
 * say so by name rather than handing plugin code `undefined` to call.
 */
export function createFluxSurface(
  discovery: IonDiscoveryApi,
  dispatcher: Dispatcher | undefined,
): FluxSurface {
  const stores = createStores(discovery);
  const interceptors: Interceptor[] = [];

  // The fan-out: one dispatcher interceptor for every subscriber, installed
  // before any other code can register one — so a payload is rewritten at
  // most once.
  const fanOut: Interceptor = (payload) => {
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
  };

  const installed: InterceptorInstall =
    dispatcher === undefined
      ? { ok: false, reason: NO_DISPATCHER }
      : installInterceptor(dispatcher, fanOut);

  return {
    get dispatcher(): Dispatcher {
      if (dispatcher === undefined) throw new Error(`shelter.flux.dispatcher: ${NO_DISPATCHER}`);
      return dispatcher;
    },
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
      if (!installed.ok) {
        // Reported here rather than only at API build: the shape was logged
        // once, but this throw is what the plugin that asked actually sees,
        // attributed to it with the same reason.
        throw new Error(`shelter.flux.intercept: ${installed.reason}`);
      }
      interceptors.push(callback);
      return () => {
        const index = interceptors.indexOf(callback);
        if (index !== -1) interceptors.splice(index, 1);
      };
    },
  };
}

/** Finds Discord's FluxDispatcher; throws with the props it was sought by. */
/** A private registry the real dispatcher keeps and a message table does not. */
function isRegistry(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/**
 * True only for the real dispatcher.
 *
 * `dispatch` and `subscribe` are not enough on their own. Discord's i18n
 * message table exports both as message functions — and it answers to
 * `_interceptors` and `addInterceptor` with message functions too, so a
 * lookup by those props reads a *function* back off the private field and
 * then turns every `subscribe("MESSAGE_CREATE", …)` into a missing
 * translation warning. The private registries are the difference: a message
 * table has no reason to carry containers named `_actionHandlers` and
 * `_subscriptions`, and if it answers with a function for those keys it is
 * still rejected.
 */
function isDispatcher(value: unknown): value is Dispatcher {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Dispatcher>;
  if (typeof candidate.dispatch !== "function") return false;
  if (typeof candidate.subscribe !== "function") return false;
  return isRegistry(candidate._actionHandlers) || isRegistry(candidate._subscriptions);
}

/**
 * Finds Discord's FluxDispatcher, or reports that this build has none.
 *
 * `findAll` rather than `findByProps` on purpose: the props match several
 * modules, and only one of them is the dispatcher. Every candidate is checked
 * and the first that holds up is used, so a lookup can never again hand a
 * plugin the wrong object and let it fail somewhere far away from the cause.
 *
 * `undefined` rather than a throw: `stores`, `storesFlat`, and `awaitStore`
 * are discovery's and do not need a dispatcher at all, so a build this gets
 * wrong should cost the two members that use it — not the whole API, and with
 * it every plugin's verdict.
 */
export function findDispatcher(discovery: IonDiscoveryApi): Dispatcher | undefined {
  // `findAll` types its results as `unknown[]` — its filter is a plain
  // predicate, not a narrowing one — so the check is repeated on the element
  // that is about to be handed out.
  for (const candidate of discovery.findAll(isDispatcher)) {
    if (isDispatcher(candidate)) return candidate;
  }
  return undefined;
}
