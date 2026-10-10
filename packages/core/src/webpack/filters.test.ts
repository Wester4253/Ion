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
    expect(filter({ alpha: 1, beta: 2 })).toBe(true);
    expect(filter({ alpha: 1 })).toBe(false);
  });

  it("treats undefined values as absent", () => {
    expect(filters.byProps("alpha")({ alpha: undefined })).toBe(false);
  });

  it("rejects null, undefined, and primitives", () => {
    expect(filters.byProps("x")(null)).toBe(false);
    expect(filters.byProps("x")(undefined)).toBe(false);
    expect(filters.byProps("toFixed")(5)).toBe(false);
  });

  it("matches functions carrying properties", () => {
    const target = Object.assign(() => undefined, { alpha: 1 });
    expect(filters.byProps("alpha")(target)).toBe(true);
  });
});

describe("filters.byCode", () => {
  const greeter = function greet(): string {
    return "hello world";
  };

  it("matches function sources", () => {
    expect(filters.byCode("hello world")(greeter)).toBe(true);
    expect(filters.byCode("goodbye")(greeter)).toBe(false);
  });

  it("rejects non-functions", () => {
    expect(filters.byCode("hello")({ toString: () => "hello world" })).toBe(false);
  });

  it("canonicalizes \\i in regex fragments", () => {
    function caller(): void {
      const target = { doThing: (): void => undefined };
      target.doThing();
    }
    expect(filters.byCode(/\i\.doThing/)(caller)).toBe(true);
    expect(filters.byCode(/\i\.otherThing/)(caller)).toBe(false);
  });
});

describe("filters.byStoreName", () => {
  function sampleStore(): object {
    const instance: Record<string, unknown> = {};
    Object.defineProperty(instance, "constructor", { value: { displayName: "SampleStore" } });
    return instance;
  }

  it("matches the constructor displayName", () => {
    expect(filters.byStoreName("SampleStore")(sampleStore())).toBe(true);
  });

  it("rejects other stores and non-objects", () => {
    expect(filters.byStoreName("OtherStore")(sampleStore())).toBe(false);
    expect(filters.byStoreName("SampleStore")(null)).toBe(false);
  });
});
