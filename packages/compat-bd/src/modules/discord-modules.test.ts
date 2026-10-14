// @vitest-environment happy-dom
/**
 * Unit tests for the lazy Discord module resolvers (React, react-dom,
 * dispatcher, notice classes). They pin the adapter's central timing
 * contract: lookups stay unresolved until the module exists, retry on every
 * access while missing, and memoize once found — including react-dom's
 * base/client merge and its identity stabilization.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";

import { getDispatcher, getNoticesBaseClasses, getReact, getReactDOM } from "./discord-modules";

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getReact", () => {
  it("returns a proxy that resolves once the module exists", () => {
    // Before Discord loads, the proxy exists but property access throws
    // a descriptive error rather than yielding undefined.
    const early = getReact();
    expect(() => (early as unknown as Record<string, unknown>)["createElement"]).toThrow(
      "BdApi.React",
    );

    const fakeReact = { createElement: () => undefined, cloneElement: () => undefined };
    findable.push(fakeReact);
    expect((getReact() as unknown as Record<string, unknown>)["createElement"]).toBe(
      fakeReact.createElement,
    );

    // Same proxy identity across calls; the resolved module is memoized.
    expect(getReact()).toBe(early);
    findable.length = 0;
    expect((getReact() as unknown as Record<string, unknown>)["createElement"]).toBe(
      fakeReact.createElement,
    );
  });
});

describe("getReactDOM", () => {
  it("throws a descriptive error before the base module exists", () => {
    expect(() => (getReactDOM() as unknown as Record<string, unknown>)["createPortal"]).toThrow(
      "BdApi.ReactDOM",
    );
  });

  it("yields a base-only snapshot, then the stable merged module", () => {
    const createPortal = (): undefined => undefined;
    const base = { createPortal };
    findable.push(base);

    const snapshot = getReactDOM() as Record<string, unknown>;
    expect(snapshot["createPortal"]).toBe(createPortal);
    expect(snapshot["createRoot"]).toBeUndefined();
    // Base-only identity is stable while the client chunk is missing.
    expect(getReactDOM()).toBe(snapshot);

    const createRoot = (): undefined => undefined;
    findable.push({ createRoot });

    const merged = getReactDOM() as Record<string, unknown>;
    expect(merged["createPortal"]).toBe(createPortal);
    expect(merged["createRoot"]).toBe(createRoot);
    // Once both parts resolve, identity stabilizes on the merged module.
    expect(getReactDOM()).toBe(merged);
  });
});

describe("getDispatcher", () => {
  it("resolves the module with dispatch/subscribe/register", () => {
    expect(getDispatcher()).toBeUndefined();

    const wrong = { dispatch: () => undefined, subscribe: () => undefined };
    findable.push(wrong);
    expect(getDispatcher()).toBeUndefined();

    const dispatcher = {
      dispatch: () => undefined,
      subscribe: () => undefined,
      register: () => undefined,
      addInterceptor: () => "interceptor-id",
    };
    findable.push(dispatcher);
    expect(getDispatcher()).toBe(dispatcher);
    expect(getDispatcher()?.addInterceptor?.(() => undefined)).toBe("interceptor-id");
  });
});

describe("getNoticesBaseClasses", () => {
  it("resolves the notice-layer layout classes", () => {
    expect(getNoticesBaseClasses()).toBeUndefined();
    findable.push({ container: "container", base: "chat-base", sidebar: "sidebar" });
    expect(getNoticesBaseClasses()?.base).toBe("chat-base");
  });
});
