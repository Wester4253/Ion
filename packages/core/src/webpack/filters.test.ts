import { describe, expect, it } from "vitest";

import { filters, stringMatches } from "./filters";

describe("stringMatches", () => {
  it("requires every fragment", () => {
    expect(stringMatches("alpha beta", ["alpha", "beta"])).toBe(true);
    expect(stringMatches("alpha beta", ["alpha", "gamma"])).toBe(false);
  });

  it("tests RegExps and resets global state", () => {
    expect(stringMatches("alpha beta", [/beta/g])).toBe(true);
    expect(stringMatches("alpha beta", [/beta/g])).toBe(true);
  });
});

describe("filters.byProps", () => {
  it("matches objects exposing every property", () => {
    const filter = filters.byProps("alpha", "beta");
    expect(filter({ alpha: 1, beta: 2 }, "test")).toBe(true);
    expect(filter({ alpha: 1 }, "test")).toBe(false);
  });

  it("treats undefined values as absent", () => {
    expect(filters.byProps("alpha")({ alpha: undefined }, "test")).toBe(false);
  });

  it("rejects null, undefined, and primitives", () => {
    expect(filters.byProps("x")(null, "test")).toBe(false);
    expect(filters.byProps("x")(undefined, "test")).toBe(false);
    expect(filters.byProps("toFixed")(5, "test")).toBe(false);
  });

  it("matches functions carrying properties", () => {
    const target = Object.assign(() => undefined, { alpha: 1 });
    expect(filters.byProps("alpha")(target, "test")).toBe(true);
  });

  it("rejects a Proxy that fabricates values without descriptors", () => {
    // react-aria's defaulting context proxies answer every string key with
    // a stable fabricated object, held outside the proxy target so no
    // descriptor ever appears anywhere; unchecked they matched
    // byProps("dispatch", "subscribe") and became FluxDispatcher.
    const fabricated = new Map<string, object>();
    const defaulting = new Proxy(
      {},
      {
        get: (_target, property) => {
          const key = String(property);
          let value = fabricated.get(key);
          if (value === undefined) {
            value = {};
            fabricated.set(key, value);
          }
          return value;
        },
      },
    );
    expect(filters.byProps("dispatch", "subscribe")(defaulting, "test")).toBe(false);
  });

  it("matches class instances through the prototype chain", () => {
    class Sample {
      public alpha(): void {
        return undefined;
      }
    }
    expect(filters.byProps("alpha")(new Sample(), "test")).toBe(true);
  });

  it("matches Proxies that forward real descriptors", () => {
    const forwarding = new Proxy({ alpha: 1 }, {});
    expect(filters.byProps("alpha")(forwarding, "test")).toBe(true);
  });
});

describe("filters.byCode", () => {
  const greeter = function greet(): string {
    return "hello world";
  };

  it("matches function sources", () => {
    expect(filters.byCode("hello world")(greeter, "test")).toBe(true);
    expect(filters.byCode("goodbye")(greeter, "test")).toBe(false);
  });

  it("rejects non-functions", () => {
    expect(filters.byCode("hello")({ toString: () => "hello world" }, "test")).toBe(false);
  });

  it("canonicalizes \\i in regex fragments", () => {
    function caller(): void {
      const target = { doThing: (): void => undefined };
      target.doThing();
    }
    expect(filters.byCode(/\i\.doThing/)(caller, "test")).toBe(true);
    expect(filters.byCode(/\i\.otherThing/)(caller, "test")).toBe(false);
  });
});

describe("filters.byStoreName", () => {
  function sampleStore(): object {
    const instance: Record<string, unknown> = {};
    Object.defineProperty(instance, "constructor", { value: { displayName: "SampleStore" } });
    return instance;
  }

  it("matches the constructor displayName", () => {
    expect(filters.byStoreName("SampleStore")(sampleStore(), "test")).toBe(true);
  });

  it("rejects other stores and non-objects", () => {
    expect(filters.byStoreName("OtherStore")(sampleStore(), "test")).toBe(false);
    expect(filters.byStoreName("SampleStore")(null, "test")).toBe(false);
  });
});
