// @vitest-environment happy-dom
/**
 * Unit tests for the `BdApi.Patcher` surface: the validation contract
 * (order and error messages), dispatch order and semantics (including
 * upstream's instead-chain quirks), unpatching, and the patch-attribution
 * deviations the compat harness depends on. The one test that needs the
 * module cache (the array form) installs the same discovery shim the
 * `BdApi.Webpack` tests use; everything else patches synthetic modules.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// These tests pin the console output the patcher produces, because the
// compat harness attributes plugin failures by reading it back off the
// `console-message` event. Referencing the spied methods is the point.
/* eslint-disable no-console */

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";

import MainPatcher, { type PatchFunction } from "../modules/patcher";
import { BoundPatcher, Patcher } from "./patcher";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validation", () => {
  const mod = { fn: (value: number) => value };
  const callback = () => undefined;

  it("rejects bad parameters in upstream's order, with upstream's messages", () => {
    const patcher = new Patcher();
    expect(() => patcher.before("Validate", mod, "fn", undefined as never)).toThrow(
      "4th parameter should be function",
    );
    expect(() => patcher.before("Validate", mod, 42 as never, callback)).toThrow(
      "3rd parameter should be function name",
    );
    expect(() => patcher.before("Validate", "not a module" as never, "fn", callback)).toThrow(
      "2nd parameter should be module",
    );
    expect(() => patcher.before(42 as never, mod, "fn", callback)).toThrow(
      "1st parameter should be string",
    );
  });

  it("checks the callback first for instead and after too", () => {
    const patcher = new Patcher();
    expect(() => patcher.instead("Validate", mod, "fn", undefined as never)).toThrow(
      "4th parameter should be function",
    );
    expect(() => patcher.after("Validate", mod, "fn", undefined as never)).toThrow(
      "4th parameter should be function",
    );
  });

  it("validates the bound surface with its own parameter positions", () => {
    const bound = new BoundPatcher("ValidateBound");
    expect(() => bound.before(mod, "fn", undefined as never)).toThrow(
      "3rd parameter should be function",
    );
    expect(() => bound.before(mod, 42 as never, callback)).toThrow(
      "2nd parameter should be function name",
    );
    expect(() => bound.before("not a module" as never, "fn", callback)).toThrow(
      "1st parameter should be module",
    );
    expect(() => bound.instead(mod, "fn", undefined as never)).toThrow(
      "3rd parameter should be function",
    );
    expect(() => bound.after(mod, "fn", undefined as never)).toThrow(
      "3rd parameter should be function",
    );
  });

  it("logs (and returns undefined) for non-string caller ids", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const patcher = new Patcher();
    expect(patcher.getPatchesByCaller(42 as never)).toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
    let call = vi.mocked(console.error).mock.calls[0] ?? [];
    expect(call).toContain(
      "Parameter 0 of getPatchesByCaller must be a string representing the caller",
    );

    patcher.unpatchAll(42 as never);
    expect(console.error).toHaveBeenCalledTimes(2);
    call = vi.mocked(console.error).mock.calls[1] ?? [];
    expect(call).toContain("Parameter 0 of unpatchAll must be a string representing the caller");
  });
});

describe("dispatch", () => {
  it("runs before callbacks, the original, then after callbacks, in order", () => {
    const order: string[] = [];
    const mod = {
      base: 5,
      fn(this: { base: number }, amount: number): number {
        order.push("original");
        return this.base + amount;
      },
    };
    const patcher = new Patcher();
    patcher.before("Order", mod, "fn", (thisObject, args) => {
      order.push("before");
      expect(thisObject).toBe(mod);
      args[0] = args[0] + 1;
    });
    patcher.after("Order", mod, "fn", (_thisObject, args, returnValue) => {
      order.push("after");
      expect(args[0]).toBe(2);
      expect(returnValue).toBe(7);
      return (returnValue as number) + 10;
    });

    expect(mod.fn(1)).toBe(17);
    expect(order).toEqual(["before", "original", "after"]);
  });

  it("ignores the return value of before callbacks", () => {
    const mod = { fn: (value: number) => value };
    const patcher = new Patcher();
    patcher.before("BeforeReturn", mod, "fn", () => 99);
    expect(mod.fn(1)).toBe(1);
  });

  it("hands later after-callbacks the return value of earlier ones", () => {
    const mod = { fn: () => 5 };
    const seen: unknown[] = [];
    const patcher = new Patcher();
    patcher.after("AfterOrder", mod, "fn", () => 7);
    patcher.after("AfterOrder", mod, "fn", (_thisObject, _args, returnValue) => {
      seen.push(returnValue);
      return 8;
    });

    expect(mod.fn()).toBe(8);
    expect(seen).toEqual([7]);
  });
});

describe("instead chains", () => {
  it("chains callbacks through the original they are handed", () => {
    const original = vi.fn((value: number) => value);
    const order: string[] = [];
    const mod = { fn: original };
    const patcher = new Patcher();
    patcher.instead("ChainA", mod, "fn", (_thisObject, args, next) => {
      order.push("A");
      const inner = next(...args) as number;
      return inner + 1;
    });
    patcher.instead("ChainB", mod, "fn", () => {
      order.push("B");
      return 10;
    });

    expect(mod.fn(1)).toBe(11);
    expect(order).toEqual(["A", "B"]);
    expect(original).not.toHaveBeenCalled();
  });

  it("reaches the real original only when the last instead calls next", () => {
    const original = vi.fn((value: number) => value * 2);
    const mod = { fn: original };
    const patcher = new Patcher();
    patcher.instead("ThroughA", mod, "fn", (_thisObject, args, next) => next(...args));
    patcher.instead("ThroughB", mod, "fn", (_thisObject, args, next) => next(...args));

    expect(mod.fn(3)).toBe(6);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("swallows the call when an instead returns undefined (upstream's semantics)", () => {
    const mod = { fn: (value: number) => value * 2 };
    const patcher = new Patcher();
    patcher.instead("Swallow", mod, "fn", () => undefined);
    expect(mod.fn(3)).toBeUndefined();
  });
});

describe("unpatching", () => {
  it("restores the original function", () => {
    const original = (value: number) => value * 2;
    const mod = { fn: original };
    const patcher = new Patcher();
    const unpatch = patcher.after("Restore", mod, "fn", () => 99);
    expect(mod.fn(1)).toBe(99);

    unpatch?.();
    expect(mod.fn).toBe(original);
    expect(mod.fn(1)).toBe(2);
  });

  it("unpatchAll cancels every patch of one caller — and only that caller", () => {
    const first = { fn: (value: number) => value };
    const second = { fn: (value: number) => value };
    const keep = { fn: (value: number) => value };
    const patcher = new Patcher();
    patcher.after("OneCaller", first, "fn", () => "first");
    patcher.before("OneCaller", second, "fn", () => undefined);
    patcher.after("OtherCaller", keep, "fn", () => "kept");

    patcher.unpatchAll("OneCaller");
    expect(first.fn(1)).toBe(1);
    expect(keep.fn(1)).toBe("kept");
    expect(patcher.getPatchesByCaller("OneCaller")).toHaveLength(0);
    expect(patcher.getPatchesByCaller("OtherCaller")).toHaveLength(1);

    patcher.unpatchAll("OtherCaller");
    expect(keep.fn(1)).toBe(1);
  });

  it("keeps the function patched until the last child unpaches", () => {
    const original = (value: number) => value;
    const mod = { fn: original };
    const patcher = new Patcher();
    const unpatchA = patcher.after("ReuseA", mod, "fn", () => "A");
    const unpatchB = patcher.after("ReuseB", mod, "fn", () => "B");

    expect(mod.fn(1)).toBe("B");
    unpatchA?.();
    expect(mod.fn).not.toBe(original);
    expect(mod.fn(1)).toBe("B");
    unpatchB?.();
    expect(mod.fn).toBe(original);
  });

  it("returns an empty list for falsy caller names", () => {
    const mod = { fn: (value: number) => value };
    const patcher = new Patcher();
    patcher.after("", mod, "fn", () => undefined);
    expect(patcher.getPatchesByCaller("")).toEqual([]);
  });

  it("scopes the bound patcher to its caller name", () => {
    const mod = { fn: (value: number) => value };
    const patcher = new Patcher();
    const bound = new BoundPatcher("BoundScope");
    bound.after(mod, "fn", () => "bound");

    expect(mod.fn(1)).toBe("bound");
    expect(patcher.getPatchesByCaller("BoundScope")).toHaveLength(1);
    bound.unpatchAll();
    expect(mod.fn(1)).toBe(1);
  });
});

describe("unpatchable targets", () => {
  it("installs a noop when force-patching a missing function", () => {
    const mod: Record<string, unknown> = {};
    const patcher = new Patcher();
    const unpatch = patcher.after("ForcePatch", mod, "missing", (() => undefined) as never);

    expect(unpatch).not.toBeNull();
    expect(typeof mod["missing"]).toBe("function");
    expect((mod["missing"] as () => unknown)()).toBeUndefined();

    unpatch?.();
    // Revert restores the noop the engine installed — upstream's behavior.
    expect(typeof mod["missing"]).toBe("function");
  });

  it("returns null and warns (attributed) when the module cannot be resolved", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const patcher = new Patcher();
    // `null` passes upstream's module validation on purpose; there is nothing
    // to patch behind it, which must surface instead of failing silently.
    expect(patcher.after("NullModule", null as never, "fn", () => undefined)).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    const call = vi.mocked(console.warn).mock.calls[0] ?? [];
    expect(String(call[0])).toBe("%c[NullModule]%c");
    expect(call).toContain("Could not patch fn: the module could not be resolved");
  });

  it("returns null and warns (attributed) when the target is not a function", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mod = { fn: "not a function" };
    const patcher = new Patcher();
    expect(patcher.after("NotAFunction", mod, "fn", (() => undefined) as never)).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    const call = vi.mocked(console.warn).mock.calls[0] ?? [];
    expect(call).toContain("Could not patch fn: the target is not a function");
  });

  it("attributes a throwing callback to its caller and keeps the original running", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boom = new Error("boom");
    const mod = { fn: (value: number) => value * 2 };
    const patcher = new Patcher();
    patcher.before("Thrower", mod, "fn", () => {
      throw boom;
    });

    expect(mod.fn(2)).toBe(4);
    expect(console.error).toHaveBeenCalledTimes(1);
    const call = vi.mocked(console.error).mock.calls[0] ?? [];
    expect(String(call[0])).toBe("%c[Thrower]%c");
    expect(call).toContain("Could not fire before callback of fn for Thrower");
    expect(call).toContain(boom);
  });

  it("routes anonymous callers' failures through the common logger", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mod = { fn: () => 1 };
    const patcher = new Patcher();
    patcher.before("", mod, "fn", () => {
      throw new Error("boom");
    });

    expect(mod.fn()).toBe(1);
    const call = vi.mocked(console.error).mock.calls[0] ?? [];
    expect(String(call[0])).toContain("[BetterDiscord]");
    expect(call).toContain("Could not fire before callback of fn for ");
  });
});

describe("integration with the module cache", () => {
  it("resolves the array form through the discovery cache", () => {
    const exports = { sendMessage: (content: string) => `sent ${content}` };
    const cache: Record<string, unknown> = {
      "1": { id: "1", loaded: true, exports },
    };
    const discovery = {
      getRequires: () => [{ c: cache }],
    } as unknown as IonDiscoveryApi;
    (window as unknown as { __ION__: IonGlobal }).__ION__ = { discovery } as unknown as IonGlobal;

    const patcher = new Patcher();
    // The array form resolves at runtime, so TypeScript cannot check the key.
    const unpatch = patcher.after(
      "ArrayForm",
      ["sendMessage"] as never,
      "sendMessage" as never,
      () => "patched",
    );

    expect(unpatch).not.toBeNull();
    expect(exports.sendMessage("hi")).toBe("patched");
    unpatch?.();
    expect(exports.sendMessage("hi")).toBe("sent hi");
  });
});

describe("patched function metadata", () => {
  it("exposes the original and delegates toString to it", () => {
    const original = (value: number) => value * 2;
    const mod = { fn: original };
    const patcher = new Patcher();
    patcher.after("Metadata", mod, "fn", () => undefined);

    const patched = mod.fn as unknown as PatchFunction;
    expect(patched.__originalFunction).toBe(original);
    expect(patched.toString()).toBe(original.toString());
  });

  it("names patches after the module, its constructor, or the anonymous fallback", () => {
    const patcher = new Patcher();

    // A plain literal has no displayName/name of its own, so the chain
    // reaches its constructor — `Object`, upstream's behavior included.
    const plain = { fn: (value: number) => value };
    patcher.after("NameChain", plain, "fn", () => undefined);
    expect(MainPatcher.patches.find((entry) => entry.module === plain)?.name).toBe("Object.fn");

    const named = { displayName: "CoolModule", fn: (value: number) => value };
    patcher.after("NameChain", named, "fn", () => undefined);
    expect(MainPatcher.patches.find((entry) => entry.module === named)?.name).toBe("CoolModule.fn");

    const bare = Object.create(null) as { fn: (value: number) => number };
    bare.fn = (value) => value;
    patcher.after("NameChain", bare, "fn", () => undefined);
    expect(MainPatcher.patches.find((entry) => entry.module === bare)?.name).toBe("anonymous.fn");
  });

  it("freezes the API classes like upstream", () => {
    expect(Object.isFrozen(Patcher)).toBe(true);
    expect(Object.isFrozen(Patcher.prototype)).toBe(true);
    expect(Object.isFrozen(BoundPatcher)).toBe(true);
    expect(Object.isFrozen(BoundPatcher.prototype)).toBe(true);
  });
});
