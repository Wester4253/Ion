/**
 * Unit tests for `shelter.flux`: store lookup through discovery (resolve,
 * cache, retry), and the interceptor protocol — one dispatcher interceptor
 * fanning out to every subscriber, with upstream's current and legacy
 * return shapes both honoured.
 */

import { describe, expect, it } from "vitest";
import type { IonDiscoveryApi } from "@ion/core";

import {
  createFluxSurface,
  findDispatcher,
  installInterceptor,
  type DispatchPayload,
  type Dispatcher,
  type Interceptor,
} from "./flux";

/** The lookup key `filters.byStoreName` produced, readable by the fake. */
interface StoreFilter {
  readonly store: string;
}

function fakeDiscovery(modules: readonly unknown[] = []): {
  api: IonDiscoveryApi;
  stores: Map<string, unknown>;
} {
  const stores = new Map<string, unknown>();
  const api = {
    find: (filter: unknown) => stores.get((filter as StoreFilter).store),
    findAll: (filter: unknown) =>
      modules.filter((value) => (filter as (value: unknown, id: string) => boolean)(value, "")),
    filters: { byStoreName: (name: string): StoreFilter => ({ store: name }) },
    waitFor: (filter: unknown, listener: (exports: unknown) => void) => {
      const found = stores.get((filter as StoreFilter).store);
      if (found !== undefined) listener(found);
      return () => undefined;
    },
  } as unknown as IonDiscoveryApi;
  return { api, stores };
}

/** A dispatcher that runs its interceptors, like Discord's does. */
function fakeDispatcher(): Dispatcher & { fire(payload: DispatchPayload): boolean } {
  return {
    _interceptors: [],
    _actionHandlers: new Map(),
    _subscriptions: new Map(),
    dispatch: () => Promise.resolve(),
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    fire(payload) {
      let blocked = false;
      const list: readonly unknown[] = Array.isArray(this._interceptors) ? this._interceptors : [];
      for (const interceptor of list) {
        if ((interceptor as (p: DispatchPayload) => unknown)(payload) === true) blocked = true;
      }
      return blocked;
    },
  };
}

/**
 * A candidate for the dispatcher. Discord's i18n message table exports
 * `dispatch` and `subscribe` as message functions, and answers to *any* other
 * key with one too — the shape that first made this lookup hand a plugin the
 * wrong object.
 */
function candidate(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    dispatch: () => Promise.resolve(),
    subscribe: () => undefined,
    ...fields,
  };
}

describe("findDispatcher", () => {
  it("takes the module carrying the dispatcher's own registries", () => {
    const dispatcher = candidate({ _actionHandlers: new Map() });
    // Present but wrong, and searched for first — the registries decide it.
    const messageTable = candidate({ _actionHandlers: () => undefined });
    const { api } = fakeDiscovery([messageTable, dispatcher]);

    expect(findDispatcher(api)).toBe(dispatcher);
  });

  it("skips a message table that answers with a function for every key", () => {
    const messageTable = candidate({
      _actionHandlers: () => undefined,
      _subscriptions: () => undefined,
      _interceptors: () => undefined,
    });
    const { api } = fakeDiscovery([messageTable]);

    expect(findDispatcher(api)).toBeUndefined();
  });

  it("reports nothing when no module holds up at all", () => {
    const { api } = fakeDiscovery([]);

    expect(findDispatcher(api)).toBeUndefined();
  });
});

describe("flux without a dispatcher", () => {
  it("keeps stores working and names the gap from the members that need one", () => {
    const { api, stores } = fakeDiscovery();
    const channelStore = { getName: () => "ChannelStore" };
    stores.set("ChannelStore", channelStore);

    const surface = createFluxSurface(api, undefined);

    // The lookup half does not need a dispatcher at all.
    expect(surface.stores["ChannelStore"]).toBe(channelStore);
    // The half that does says so, instead of handing plugin code undefined.
    expect(() => surface.dispatcher).toThrow(/no Discord FluxDispatcher/);
    expect(() => surface.intercept(() => undefined)).toThrow(/no Discord FluxDispatcher/);
  });
});

describe("flux.stores", () => {
  it("resolves a store by name and caches the answer", () => {
    const { api, stores } = fakeDiscovery();
    const channelStore = { getName: () => "ChannelStore" };
    stores.set("ChannelStore", channelStore);

    const surface = createFluxSurface(api, fakeDispatcher());
    expect(surface.stores["ChannelStore"]).toBe(channelStore);
    // Cached, so a later lookup does not go back to discovery.
    stores.delete("ChannelStore");
    expect(surface.stores["ChannelStore"]).toBe(channelStore);
  });

  it("stays quiet and retries when Discord has not evaluated the store", () => {
    const { api, stores } = fakeDiscovery();
    const surface = createFluxSurface(api, fakeDispatcher());

    expect(surface.stores["RelationshipStore"]).toBeUndefined();
    const late = { getName: () => "RelationshipStore" };
    stores.set("RelationshipStore", late);
    expect(surface.stores["RelationshipStore"]).toBe(late);
  });

  it("lets a plugin assign its own entry, which wins over discovery", () => {
    const { api, stores } = fakeDiscovery();
    stores.set("ChannelStore", { real: true });

    const surface = createFluxSurface(api, fakeDispatcher());
    surface.stores["ChannelStore"] = { injected: true };

    expect(surface.stores["ChannelStore"]).toEqual({ injected: true });
  });

  it("unwraps array-valued lookups in storesFlat", () => {
    const { api, stores } = fakeDiscovery();
    const first = { id: 1 };
    stores.set("Multi", [first, { id: 2 }]);

    const surface = createFluxSurface(api, fakeDispatcher());
    expect(surface.storesFlat["Multi"]).toBe(first);
    expect(surface.stores["Multi"]).toEqual([first, { id: 2 }]);
  });
});

describe("flux.intercept", () => {
  it("lets an interceptor rewrite a payload in place", () => {
    const { api } = fakeDiscovery();
    const dispatcher = fakeDispatcher();
    const surface = createFluxSurface(api, dispatcher);

    surface.intercept((payload) => ({ ...payload, rewritten: true }));

    const payload: DispatchPayload = { type: "MESSAGE_CREATE" };
    expect(dispatcher.fire(payload)).toBe(false);
    expect(payload).toEqual({ type: "MESSAGE_CREATE", rewritten: true });
  });

  it("blocks the dispatch when an interceptor returns a falsy value", () => {
    const { api } = fakeDiscovery();
    const dispatcher = fakeDispatcher();
    const surface = createFluxSurface(api, dispatcher);

    surface.intercept(() => false);
    expect(dispatcher.fire({ type: "MESSAGE_CREATE" })).toBe(true);
  });

  it("does nothing when an interceptor returns nullish", () => {
    const { api } = fakeDiscovery();
    const dispatcher = fakeDispatcher();
    const surface = createFluxSurface(api, dispatcher);

    surface.intercept(() => undefined);
    const payload: DispatchPayload = { type: "READY" };
    expect(dispatcher.fire(payload)).toBe(false);
    expect(payload).toEqual({ type: "READY" });
  });

  it("honours the legacy [modified, shouldDrop] return shape", () => {
    const { api } = fakeDiscovery();
    const dispatcher = fakeDispatcher();
    const surface = createFluxSurface(api, dispatcher);

    surface.intercept((payload) => [{ ...payload, legacy: 1 }, true]);

    const payload: DispatchPayload = { type: "GUILD_CREATE" };
    expect(dispatcher.fire(payload)).toBe(true);
    expect(payload).toEqual({ type: "GUILD_CREATE", legacy: 1 });
  });

  it("stops delivering once unsubscribed", () => {
    const { api } = fakeDiscovery();
    const dispatcher = fakeDispatcher();
    const surface = createFluxSurface(api, dispatcher);

    const seen: unknown[] = [];
    const unintercept = surface.intercept((payload) => {
      seen.push(payload["type"]);
    });

    dispatcher.fire({ type: "A" });
    unintercept();
    dispatcher.fire({ type: "B" });

    expect(seen).toEqual(["A"]);
  });
});

describe("flux.awaitStore", () => {
  it("returns a store that is already initialized", async () => {
    const { api, stores } = fakeDiscovery();
    stores.set("Ready", { _isInitialized: true });

    const surface = createFluxSurface(api, fakeDispatcher());
    await expect(surface.awaitStore("Ready")).resolves.toEqual({ _isInitialized: true });
  });

  it("resolves only once the store flips its initialized flag", async () => {
    const { api, stores } = fakeDiscovery();
    const store = { _isInitialized: false };
    stores.set("Lazy", store);

    const surface = createFluxSurface(api, fakeDispatcher());
    let resolved = false;
    const pending = surface.awaitStore("Lazy").then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    store._isInitialized = true;
    await pending;
    expect(resolved).toBe(true);
  });
});

describe("installInterceptor", () => {
  const handler: Interceptor = () => false;

  function dispatcherWith(fields: Partial<Dispatcher>): Dispatcher {
    return {
      dispatch: () => Promise.resolve(),
      subscribe: () => undefined,
      unsubscribe: () => undefined,
      ...fields,
    };
  }

  it("uses the dispatcher's array when there is one, as upstream does", () => {
    const dispatcher = dispatcherWith({ _interceptors: [] });

    expect(installInterceptor(dispatcher, handler)).toEqual({ ok: true, via: "array" });
    expect(dispatcher._interceptors).toEqual([handler]);
  });

  it("creates the list when the field is absent, mirroring upstream's ??=", () => {
    const dispatcher = dispatcherWith({});

    expect(installInterceptor(dispatcher, handler)).toEqual({ ok: true, via: "array" });
    expect(dispatcher._interceptors).toEqual([handler]);
  });

  it("falls back to Discord's own installer when the field is not an array", () => {
    const added: Interceptor[] = [];
    const dispatcher = dispatcherWith({
      _interceptors: new Set<Interceptor>(),
      addInterceptor: (interceptor) => {
        added.push(interceptor);
      },
    });

    expect(installInterceptor(dispatcher, handler)).toEqual({ ok: true, via: "addInterceptor" });
    expect(added).toEqual([handler]);
  });

  it("refuses, naming the shape it found, when neither path exists", () => {
    const dispatcher = dispatcherWith({ _interceptors: "a string" });
    const outcome = installInterceptor(dispatcher, handler);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("holds string");
  });

  it("keeps the rest of the surface usable and throws by name from intercept", () => {
    const { api } = fakeDiscovery();
    const surface = createFluxSurface(api, dispatcherWith({ _interceptors: "a string" }));

    // The API build survives — this is what cost every plugin its verdict
    // when the field was read unconditionally.
    expect(surface.dispatcher).toBeDefined();
    expect(() => surface.intercept(() => undefined)).toThrow(/no dispatcher interceptor/);
  });
});
