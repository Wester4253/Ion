// @vitest-environment happy-dom
/**
 * Unit tests for the assembled `BdApi` surface: shared vs plugin-scoped
 * member identities, instance caching, the deferred React/ReactDOM
 * getters, and the upstream freeze contract.
 */

// The unusable-name test asserts on the error the constructor logs; the
// compat harness attributes plugin failures by reading console output
// back, so referencing it is the point.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";

import { BdApi } from "./index";
import { BoundHooks, Hooks } from "./hooks";
import { UI } from "./ui";
import { Net } from "./network";
import { ReactUtils } from "./reactutils";

let findable: unknown[];

beforeEach(() => {
  findable = [];
  const discovery = {
    find: (filter: (exports: unknown) => boolean) => {
      for (const candidate of findable) {
        if (candidate === null || candidate === undefined) continue;
        if (filter(candidate)) return candidate;
      }
      return undefined;
    },
    getRequires: () => [],
    waitFor: () => () => undefined,
  } as unknown as IonDiscoveryApi;
  (window as unknown as { __ION__: IonGlobal }).__ION__ = { discovery } as unknown as IonGlobal;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("static surface", () => {
  it("reports the mirrored BetterDiscord version", () => {
    expect(BdApi.version).toBe("1.14.2");
    expect(new BdApi().version).toBe("1.14.2");
  });

  it("shares stateless and single-instance members", () => {
    const api = new BdApi("PluginA");
    expect(api.Webpack).toBe(BdApi.Webpack);
    expect(api.Utils).toBe(BdApi.Utils);
    expect(api.UI).toBe(BdApi.UI);
    expect(api.Net).toBe(BdApi.Net);
    expect(api.ReactUtils).toBe(BdApi.ReactUtils);
    expect(api.ContextMenu).toBe(BdApi.ContextMenu);
    expect(BdApi.UI).toBeInstanceOf(UI);
    expect(BdApi.Net).toBeInstanceOf(Net);
    expect(BdApi.ReactUtils).toBeInstanceOf(ReactUtils);
    expect(BdApi.Hooks).toBeInstanceOf(Hooks);
  });

  it("is frozen, as upstream is", () => {
    expect(Object.isFrozen(BdApi)).toBe(true);
    expect(Object.isFrozen(BdApi.prototype)).toBe(true);
  });
});

describe("plugin-scoped instances", () => {
  it("caches instances per plugin name", () => {
    const first = new BdApi("PluginB");
    expect(new BdApi("PluginB")).toBe(first);
    expect(new BdApi("PluginC")).not.toBe(first);
  });

  it("binds per-plugin members and keeps shared ones shared", () => {
    const api = new BdApi("PluginD");
    // Scoped members differ from the static, unbound surfaces.
    expect(api.Patcher).not.toBe(BdApi.Patcher);
    // BoundPatcher is its own class (no shared prototype with the static one),
    // so identity + callable surface is the contract to assert.
    expect(api.Patcher).toHaveProperty("after", expect.any(Function));
    expect(api.Hooks).not.toBe(BdApi.Hooks);
    expect(api.Hooks).toBeInstanceOf(BoundHooks);
    expect(new BdApi("PluginE").Hooks).not.toBe(api.Hooks);
    // Each named instance gets its own logger and data scopes.
    expect(api.Logger).not.toBe(BdApi.Logger);
    expect(api.Data).not.toBe(BdApi.Data);
    expect(api.DOM).not.toBe(BdApi.DOM);
  });

  it("keeps the generic surface unbound", () => {
    const generic = new BdApi();
    expect(generic.Patcher).toBe(BdApi.Patcher);
    expect(generic.Data).toBe(BdApi.Data);
    expect(generic.Hooks).toBe(BdApi.Hooks);
    expect(generic.Logger).toBe(BdApi.Logger);
  });

  it("rejects unusable names with an error and the generic surface", () => {
    const invalid = new BdApi(42 as unknown as string);
    expect(console.error).toHaveBeenCalled();
    expect(invalid.Patcher).toBe(BdApi.Patcher);
  });
});

describe("deferred React getters", () => {
  it("resolve Discord's React on first access", () => {
    // Before Discord loads, the proxy exists but property access throws.
    expect(() => (BdApi.React as unknown as Record<string, unknown>)["createElement"]).toThrow(
      "BdApi.React",
    );
    expect(() => (BdApi.ReactDOM as unknown as Record<string, unknown>)["createPortal"]).toThrow(
      "BdApi.ReactDOM",
    );

    const fakeReact = { createElement: () => undefined, cloneElement: () => undefined };
    findable.push(fakeReact);
    expect((BdApi.React as unknown as Record<string, unknown>)["createElement"]).toBe(
      fakeReact.createElement,
    );
    expect(
      (new BdApi("PluginF").React as unknown as Record<string, unknown>)["createElement"],
    ).toBe(fakeReact.createElement);
  });
});
