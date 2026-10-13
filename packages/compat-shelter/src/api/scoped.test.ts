// @vitest-environment happy-dom
/**
 * Unit tests for `shelter.plugin.scoped`: the contract that makes a plugin
 * removable. Every registration returns an unregister, `disposeAllNow` plays
 * them all back, one broken teardown does not strand the rest, and callbacks
 * registered through the scope run under the owning plugin's log attribution.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { currentPluginScope } from "../logger";
import type { DispatchPayload, FluxSurface, Interceptor } from "./flux";
import type { HttpSurface, HttpResponse } from "./httpapi";
import { createScopedApi, type ScopedApiDeps } from "./scoped";
import { createSettingsSurface } from "./settings";

const SCOPE = { id: "shelter.demo", name: "Demo" };

interface FakeFlux extends FluxSurface {
  readonly subscribes: string[];
  readonly unsubscribes: string[];
  /** Listeners `dispatcher.subscribe` recorded, keyed by event type. */
  readonly listeners: Map<string, (payload: DispatchPayload) => void>;
}

function fakeFlux(): FakeFlux {
  const subscribes: string[] = [];
  const unsubscribes: string[] = [];
  const listeners = new Map<string, (payload: DispatchPayload) => void>();
  const interceptors: Interceptor[] = [];
  return {
    subscribes,
    unsubscribes,
    listeners,
    dispatcher: {
      dispatch: () => Promise.resolve(),
      subscribe: (type, listener) => {
        subscribes.push(type);
        listeners.set(type, listener);
      },
      unsubscribe: (type) => {
        unsubscribes.push(type);
        listeners.delete(type);
      },
    },
    stores: {},
    storesFlat: {},
    awaitStore: () => Promise.resolve({}),
    intercept: (callback) => {
      interceptors.push(callback);
      return () => {
        unsubscribes.push("intercept");
      };
    },
  };
}

interface FakeHttp extends HttpSurface {
  readonly intercepts: string[];
}

function fakeHttp(): FakeHttp {
  const intercepts: string[] = [];
  const call = (): Promise<HttpResponse> => Promise.resolve({ status: 204 });
  return {
    intercepts,
    ready: Promise.resolve(),
    get: call,
    post: call,
    put: call,
    patch: call,
    del: call,
    _raw: undefined,
    intercept: (method) => {
      intercepts.push(method);
      return () => {
        intercepts.push(`un:${method}`);
      };
    },
  };
}

function fakeDeps(): { deps: ScopedApiDeps; flux: FakeFlux; http: FakeHttp; warns: string[] } {
  const flux = fakeFlux();
  const http = fakeHttp();
  const warns: string[] = [];
  const settings = createSettingsSurface((message) => warns.push(message));
  return { deps: { flux, http, settings }, flux, http, warns };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scoped disposal", () => {
  it("returns an unregister from every registration it records", () => {
    const { deps, flux, http } = fakeDeps();
    const scoped = createScopedApi(deps, SCOPE);

    const unsubscribe = scoped.flux.subscribe("MESSAGE_CREATE", () => undefined);
    const unintercept = scoped.flux.intercept(() => undefined);
    const unhttp = scoped.http.intercept("get", "v9/channels", () => Promise.resolve({}));
    const unsection = scoped.settings.registerSection(["divider"]);
    const unstyle = scoped.ui.injectCss(".scoped-test { color: red; }");

    expect(flux.subscribes).toEqual(["MESSAGE_CREATE"]);
    expect(http.intercepts).toEqual(["get"]);

    unsubscribe();
    unintercept();
    unhttp();
    unsection();
    unstyle();

    expect(flux.unsubscribes).toEqual(["MESSAGE_CREATE", "intercept"]);
    expect(http.intercepts).toEqual(["get", "un:get"]);
    // Each of those five also got recorded for `disposeAllNow`.
    expect(scoped.disposes).toHaveLength(5);
  });

  it("plays every recorded cleanup back, even when one of them throws", () => {
    const { deps } = fakeDeps();
    const scoped = createScopedApi(deps, SCOPE);
    const seen: string[] = [];

    scoped.onDispose(() => {
      throw new Error("broken teardown");
    });
    scoped.onDispose(() => {
      seen.push("after-broken");
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    scoped.disposeAllNow();

    expect(seen).toEqual(["after-broken"]);
    expect(scoped.disposes).toEqual([]);
    expect(consoleError).toHaveBeenCalledOnce();

    // Reported under the owning plugin, not as an anonymous adapter line.
    const printed = consoleError.mock.calls.flat().join(" ");
    expect(printed).toContain("[Demo]");
    expect(printed).toContain("broken teardown");
  });

  it("leaves nothing behind once disposal is done", () => {
    const { deps, flux } = fakeDeps();
    const scoped = createScopedApi(deps, SCOPE);
    scoped.flux.subscribe("READY", () => undefined);

    scoped.disposeAllNow();
    expect(scoped.disposes).toEqual([]);
    expect(flux.unsubscribes).toEqual(["READY"]);
  });
});

describe("scoped attribution", () => {
  it("runs a dispatcher callback under the owning plugin's scope", () => {
    const { deps, flux } = fakeDeps();
    const scoped = createScopedApi(deps, SCOPE);

    let seen: string | undefined;
    scoped.flux.subscribe("MESSAGE_CREATE", () => {
      seen = currentPluginScope()?.name;
    });
    flux.listeners.get("MESSAGE_CREATE")?.({ type: "MESSAGE_CREATE" });

    expect(seen).toBe("Demo");
  });

  it("attributes a settings-section warning to whoever registered it", () => {
    const { deps, warns } = fakeDeps();
    const scoped = createScopedApi(deps, SCOPE);

    scoped.settings.registerSection(["header", "Demo"]);

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("not drawn into Discord's settings");
  });
});
