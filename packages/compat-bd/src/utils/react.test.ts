// @vitest-environment happy-dom
/**
 * Unit tests for the React helpers: `getType` unwrapping, the fiber and
 * owner-instance lookups, the DOM wrapper component, and the
 * out-of-lifecycle hook dispatcher swap in `wrapInHooks`. React itself is
 * a test double resolved through the lazy module discovery, matching how
 * the helpers reach it in the real client.
 *
 * `getReact` memoizes for the file, so there is exactly one fake React:
 * the "before React loads" tests run ahead of any injection, and tests
 * that mutate the fake restore it.
 */

// The deleted-private-handle test asserts on the error the fallback logs;
// the compat harness attributes plugin failures by reading console output
// back, so referencing it is the point.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";

import type { BdReact, BdReactComponent } from "../modules/discord-modules";
import {
  getInternalInstance,
  getOwnerInstance,
  getType,
  wrapElement,
  wrapInHooks,
  type BdFiber,
} from "./react";

const ELEMENT = Symbol.for("react.element");

class FakeComponent {
  props: Record<string, unknown>;
  state: Record<string, unknown> = {};
  constructor(props: Record<string, unknown>) {
    this.props = props;
  }
  setState(next: Record<string, unknown>): void {
    Object.assign(this.state, next);
  }
}

interface Dispatcher {
  useState: (initial: unknown) => unknown;
}

const dispatcher: Dispatcher = { useState: () => ["real", null] };

const fakeReact = {
  Component: FakeComponent,
  Fragment: Symbol.for("react.fragment"),
  createElement: (type: unknown, props?: object | null) => ({
    $$typeof: ELEMENT,
    type,
    props: (props ?? {}) as Record<string, unknown>,
  }),
  cloneElement: (element: unknown, props?: object | null) => ({
    ...(element as Record<string, unknown>),
    props: {
      ...((element as { props?: Record<string, unknown> }).props ?? {}),
      ...(props ?? {}),
    },
  }),
  isValidElement: (value: unknown) =>
    typeof value === "object" && value !== null && "$$typeof" in value,
  createRef: () => ({ current: null }),
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: dispatcher },
} as unknown as BdReact;

let findable: unknown[];

beforeEach(() => {
  findable = [];
  dispatcher.useState = () => ["real", null];
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
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("before React loads", () => {
  it("wrapElement and wrapInHooks throw a clear error", () => {
    expect(() => wrapElement(document.createElement("div"))).toThrow(/not loaded yet/);
    expect(() => wrapInHooks(() => null)).toThrow(/not loaded yet/);
  });
});

describe("getType", () => {
  const component = (): null => null;

  it("passes plain values through", () => {
    expect(getType(component)).toBe(component);
    expect(getType(null)).toBeNull();
    expect(getType(undefined)).toBeUndefined();
    expect(getType("div")).toBe("div");
    expect(getType(42)).toBe(42);
  });

  it("unwraps memo and forwardRef", () => {
    const memo = { $$typeof: Symbol.for("react.memo"), type: component };
    expect(getType(memo)).toBe(component);

    const forwardRef = { $$typeof: Symbol.for("react.forward_ref"), render: component };
    expect(getType(forwardRef)).toBe(component);

    const nested = { $$typeof: Symbol.for("react.memo"), type: forwardRef };
    expect(getType(nested)).toBe(component);
  });

  it("unwraps resolved lazy values and no-ops unresolved ones", () => {
    const resolved = {
      $$typeof: Symbol.for("react.lazy"),
      _payload: { _status: 1, _result: { default: component } },
    };
    expect(getType(resolved)).toBe(component);

    const unresolved = { $$typeof: Symbol.for("react.lazy"), _payload: { _status: 0 } };
    const fallback = getType(unresolved);
    expect(typeof fallback).toBe("function");
    expect((fallback as () => unknown)()).toBeUndefined();
  });
});

describe("getInternalInstance", () => {
  it("reads whichever fiber key this React version stamped", () => {
    const node = document.createElement("div");
    expect(getInternalInstance(node)).toBeNull();

    const fiber: BdFiber = { return: null };
    Reflect.set(node, "__reactFiber$abc123", fiber);
    expect(getInternalInstance(node)).toBe(fiber);

    const legacyNode = document.createElement("span");
    const legacyFiber: BdFiber = { return: null };
    Reflect.set(legacyNode, "__reactInternalInstance$xyz789", legacyFiber);
    expect(getInternalInstance(legacyNode)).toBe(legacyFiber);
  });
});

describe("getOwnerInstance", () => {
  function buildChain(
    ownerType: { displayName?: string },
    ownerInstance: Record<string, unknown>,
  ): Element {
    const root: BdFiber = { return: null, stateNode: null, type: null };
    const tooltip: BdFiber = { return: root, stateNode: {}, type: { displayName: "Tooltip" } };
    const owner: BdFiber = { return: tooltip, stateNode: ownerInstance, type: ownerType };
    const nodeFiber: BdFiber = {
      return: owner,
      stateNode: document.createElement("div"),
      type: { displayName: "Message" },
    };
    const node = document.createElement("div");
    Reflect.set(node, "__reactFiber$test", nodeFiber);
    return node;
  }

  it("walks up to the nearest class component", () => {
    const instance = { render: () => undefined };
    const node = buildChain({ displayName: "ChannelHeader" }, instance);
    expect(getOwnerInstance(node)).toBe(instance);
  });

  it("excludes the default and caller-listed display names", () => {
    const tooltipInstance = { render: () => undefined };
    const node = buildChain({ displayName: "Tooltip" }, tooltipInstance);
    expect(getOwnerInstance(node)).toBeNull();
    expect(getOwnerInstance(node, { include: ["Tooltip"] })).toBe(tooltipInstance);
    // A caller-supplied exclude list REPLACES the default one (upstream
    // semantics), so both names must be listed to filter the whole chain.
    expect(
      getOwnerInstance(buildChain({ displayName: "ChannelHeader" }, {}), {
        exclude: ["ChannelHeader", "Tooltip"],
      }),
    ).toBeNull();
  });

  it("honors the instance filter", () => {
    const instance = { render: () => undefined };
    const node = buildChain({ displayName: "ChannelHeader" }, instance);
    expect(getOwnerInstance(node, { filter: (owner) => owner === instance })).toBe(instance);
    expect(getOwnerInstance(node, { filter: () => false })).toBeNull();
    expect(getOwnerInstance(undefined)).toBeNull();
  });

  it("skips fibers whose stateNode is a DOM node", () => {
    const instance = { render: () => undefined };
    const root: BdFiber = { return: null, stateNode: null, type: null };
    const owner: BdFiber = { return: root, stateNode: instance, type: { displayName: "App" } };
    const host: BdFiber = {
      return: owner,
      stateNode: document.createElement("div"),
      type: { displayName: "Hostish" },
    };
    const nodeFiber: BdFiber = {
      return: host,
      stateNode: document.createElement("span"),
      type: { displayName: "Message" },
    };
    const node = document.createElement("div");
    Reflect.set(node, "__reactFiber$test", nodeFiber);
    expect(getOwnerInstance(node)).toBe(instance);
  });
});

describe("wrapElement", () => {
  type WrapperInstance = BdReactComponent & {
    ref: { current: unknown };
    componentDidMount(): void;
    componentDidCatch(): void;
  };

  it("appends the element into the rendered wrapper on mount", () => {
    findable.push(fakeReact);

    const child = document.createElement("span");
    const Wrapper = wrapElement(child);
    const instance = new Wrapper({}) as WrapperInstance;

    const rendered = instance.render() as { props: Record<string, unknown> };
    expect(rendered.props["className"]).toBe("react-wrapper");

    const appended: Element[] = [];
    (rendered.props["ref"] as { current: unknown }).current = {
      appendChild: (node: Element) => appended.push(node),
    };
    instance.componentDidMount();
    expect(appended).toEqual([child]);
  });

  it("appends every child for array input and renders null after an error", () => {
    findable.push(fakeReact);

    const children = [document.createElement("i"), document.createElement("b")];
    const Wrapper = wrapElement(children);
    const instance = new Wrapper({}) as WrapperInstance;

    const rendered = instance.render() as { props: Record<string, unknown> };
    const appended: Element[] = [];
    (rendered.props["ref"] as { current: unknown }).current = {
      appendChild: (node: Element) => appended.push(node),
    };
    instance.componentDidMount();
    expect(appended).toEqual(children);

    instance.componentDidCatch();
    expect(instance.render()).toBeNull();
  });
});

describe("wrapInHooks", () => {
  it("swaps the dispatcher's hooks during render and restores them after", () => {
    findable.push(fakeReact);

    const seen: unknown[] = [];
    const component = (): unknown => {
      const hooks = dispatcher.useState(5);
      seen.push(hooks);
      return (hooks as [unknown])[0];
    };

    const wrapped = wrapInHooks(component);
    expect(wrapped({})).toBe(5);
    // The patched useState returns the initial state, not React's.
    expect(seen).toEqual([[5, expect.any(Function)]]);

    // The original hook table is restored once render finishes.
    expect(dispatcher.useState(1)).toEqual(["real", null]);
  });

  it("applies custom patches over the defaults", () => {
    findable.push(fakeReact);

    const component = (): unknown => (dispatcher.useState(1) as [unknown])[0];
    const customUseState = <T>(initial: T | (() => T)): [state: T, setState: () => void] => {
      // The patch receives the same initial state the component passed.
      expect(initial).toBe(1);
      return ["custom" as unknown as T, () => undefined];
    };
    const wrapped = wrapInHooks(component, { useState: customUseState });
    expect(wrapped({})).toBe("custom");
    expect(dispatcher.useState(1)).toEqual(["real", null]);
  });

  it("renders nothing for React's unresolved-use error and rethrows others", () => {
    findable.push(fakeReact);

    const suspenseError =
      "Minified React error #460; visit https://react.dev/errors/460 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
    const suspending = (): unknown => {
      throw new Error(suspenseError);
    };
    expect(wrapInHooks(suspending)({})).toBeUndefined();

    const broken = (): never => {
      throw new Error("boom");
    };
    expect(() => wrapInHooks(broken)({})).toThrow("boom");
  });

  it("falls back to a direct render when React's private handle is gone", () => {
    findable.push(fakeReact);
    // Simulate a React version bump renaming the private handle.
    const internals = fakeReact as unknown as Record<string, unknown>;
    const handleKey = "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE";
    const saved = internals[handleKey];
    Reflect.deleteProperty(internals, handleKey);

    const wrapped = wrapInHooks((props: Record<string, unknown>) => props["value"]);
    expect(wrapped({ value: "as-is" })).toBe("as-is");
    expect(console.error).toHaveBeenCalled();

    internals[handleKey] = saved;
  });

  it("resolves memo-wrapped components before wrapping", () => {
    findable.push(fakeReact);

    const memoized = {
      $$typeof: Symbol.for("react.memo"),
      type: (props: Record<string, unknown>) => props["label"],
    };
    const wrapped = wrapInHooks(memoized);
    expect(wrapped({ label: "memo" })).toBe("memo");
  });
});
