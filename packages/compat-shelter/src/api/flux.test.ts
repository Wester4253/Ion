/**
 * Unit tests for `shelter.flux`: store lookup through discovery (resolve,
 * cache, retry), and the interceptor protocol — one dispatcher interceptor
 * fanning out to every subscriber, with upstream's current and legacy
 * return shapes both honoured.
 */

import { describe, expect, it } from "vitest";
import type { IonDiscoveryApi } from "@ion/core";

import { createFluxSurface, findDispatcher, type DispatchPayload, type Dispatcher } from "./flux";

/** The lookup key `filters.byStoreName` produced, readable by the fake. */
interface StoreFilter {
  readonly store: string;
}

function fakeDiscovery(): { api: IonDiscoveryApi; stores: Map<string, unknown> } {
  const stores = new Map<string, unknown>();
  const api = {
    find: (filter: unknown) => stores.get((filter as StoreFilter).store),
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
    dispatch: () => Promise.resolve(),
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    fire(payload) {
      let blocked = false;
      for (const interceptor of this._interceptors ?? []) {
        if ((interceptor as (p: DispatchPayload) => unknown)(payload) === true) blocked = true;
      }
      return blocked;
    },
  };
}

describe("findDispatcher", () => {
  it("rejects a module that is not a dispatcher, naming the props it sought", () => {
    const { api } = fakeDiscovery();
    (api as unknown as { findByProps: () => unknown }).findByProps = () => ({});

    expect(() => findDispatcher(api)).toThrow(/a module exposing dispatch \+ subscribe/);
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
