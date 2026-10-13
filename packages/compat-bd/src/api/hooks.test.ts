// @vitest-environment happy-dom
/**
 * Unit tests for the `BdApi.Hooks` surface: `useStateFromStores`
 * (subscribe, re-render only when the value changed, cleanup, deps) and
 * `useData`'s plugin scoping. React is an immediate-hooks double: hooks
 * run synchronously, refs persist across simulated renders, and dispatches
 * are counted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";

import { BoundHooks, Hooks } from "./hooks";
import { useForceUpdate, useStateFromStores, type StoreLike } from "../ui/hooks";

let findable: unknown[];
let dispatchCount: number;
let refs: { current: unknown }[];
let refIndex: number;
let cleanups: (() => void)[];

const fakeReact = {
  // The module discovery filter matches React by these two keys; without
  // them `getReact()` never resolves and the hooks fall back to factory mode.
  createElement: () => undefined,
  cloneElement: () => undefined,
  useReducer: () => [
    0,
    () => {
      dispatchCount++;
    },
  ],
  useRef: <T>(initial: T | null) => {
    const existing = refs[refIndex];
    if (existing) {
      refIndex++;
      return existing as { current: T | null };
    }
    const created = { current: initial };
    refs[refIndex++] = created;
    return created;
  },
  useInsertionEffect: (effect: () => unknown) => {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup as () => void);
  },
};

class FakeStore implements StoreLike {
  readonly listeners = new Set<() => void>();
  readonly addChangeListener = vi.fn((listener: () => void) => {
    this.listeners.add(listener);
  });
  readonly removeChangeListener = vi.fn((listener: () => void) => {
    this.listeners.delete(listener);
  });

  emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Simulates one render: hook slot state (refs) persists between calls. */
function render<T>(hook: () => T): T {
  refIndex = 0;
  return hook();
}

beforeEach(() => {
  findable = [];
  dispatchCount = 0;
  refs = [];
  refIndex = 0;
  cleanups = [];
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

  // happy-dom has no localStorage; shim it the way data.test.ts does.
  const backing = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, value);
      },
      removeItem: (key: string) => {
        backing.delete(key);
      },
      clear: () => {
        backing.clear();
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useStateFromStores", () => {
  it("falls back to the factory while React is unavailable", () => {
    const store = new FakeStore();
    expect(useStateFromStores(store, () => "direct")).toBe("direct");
    expect(store.addChangeListener).not.toHaveBeenCalled();
  });

  it("re-renders when the store's value changes, and only then", () => {
    findable.push(fakeReact);
    const store = new FakeStore();
    let value = "a";

    const first = render(() => useStateFromStores(store, () => value));
    expect(first).toBe("a");
    expect(store.addChangeListener).toHaveBeenCalledOnce();

    value = "b";
    store.emit();
    expect(dispatchCount).toBe(1);

    // A re-render sees the listener's updated state.
    expect(render(() => useStateFromStores(store, () => value))).toBe("b");

    // An unchanged value must not re-render again.
    store.emit();
    expect(dispatchCount).toBe(1);
  });

  it("shallow-compares objects when asked", () => {
    findable.push(fakeReact);
    const store = new FakeStore();
    let state: Record<string, number> = { count: 1 };

    render(() => useStateFromStores(store, () => state, undefined, true));

    // A new object with equal contents: shallow-equal → no re-render.
    state = { count: 1 };
    store.emit();
    expect(dispatchCount).toBe(0);

    state = { count: 2 };
    store.emit();
    expect(dispatchCount).toBe(1);
  });

  it("subscribes to every store in a list", () => {
    findable.push(fakeReact);
    const first = new FakeStore();
    const second = new FakeStore();

    render(() => useStateFromStores([first, second], () => "x"));
    expect(first.addChangeListener).toHaveBeenCalledOnce();
    expect(second.addChangeListener).toHaveBeenCalledOnce();

    for (const cleanup of cleanups) cleanup();
    expect(first.removeChangeListener).toHaveBeenCalledOnce();
    expect(second.removeChangeListener).toHaveBeenCalledOnce();
  });

  it("recomputes on dependency changes and rejects size changes", () => {
    findable.push(fakeReact);
    const store = new FakeStore();
    let key = "x";
    let stored = "one";

    const factory = vi.fn(() => stored);
    expect(render(() => useStateFromStores(store, factory, [key]))).toBe("one");

    stored = "two";
    key = "y";
    expect(render(() => useStateFromStores(store, factory, [key]))).toBe("two");
    expect(factory).toHaveBeenCalledTimes(2);

    expect(() => render(() => useStateFromStores(store, factory, [key, "extra"]))).toThrow(
      "Dependency List Size Changed!",
    );
  });
});

describe("useForceUpdate", () => {
  it("dispatches when called", () => {
    findable.push(fakeReact);
    const [count, forceUpdate] = render(() => useForceUpdate());
    expect(count).toBe(0);
    forceUpdate();
    expect(dispatchCount).toBe(1);
  });
});

describe("useData", () => {
  it("reads the caller plugin's data, static and bound", () => {
    findable.push(fakeReact);
    window.localStorage.setItem("ION_BD_DATA_Alice", JSON.stringify({ theme: "dark" }));
    window.localStorage.setItem("ION_BD_DATA_Bob", JSON.stringify({ theme: "light" }));

    const hooks = new Hooks();
    expect(render(() => hooks.useData("Alice", "theme"))).toBe("dark");

    const bound = new BoundHooks("Bob");
    expect(render(() => bound.useData("theme"))).toBe("light");

    // Missing keys read as undefined rather than throwing.
    expect(render(() => bound.useData("missing"))).toBeUndefined();
  });

  it("keeps the class surfaces frozen, as upstream does", () => {
    expect(Object.isFrozen(Hooks)).toBe(true);
    expect(Object.isFrozen(Hooks.prototype)).toBe(true);
    expect(Object.isFrozen(BoundHooks.prototype)).toBe(true);
  });
});
