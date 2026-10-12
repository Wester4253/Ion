// @vitest-environment happy-dom
/**
 * Unit tests for the `BdApi.Data` surface over the adapter's localStorage-
 * backed JsonStore: falsey-value round-trips, per-plugin isolation,
 * undefined-as-no-op vs explicit delete, recache success/failure reporting,
 * and the plugin-scoped bound instance.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { BoundData, Data } from "./data";

beforeEach(() => {
  // happy-dom 20 only wires up Storage for a full browser context, which
  // vitest's environment does not create; back the tests with a Map instead.
  // The store only uses getItem/setItem, exactly like a real Storage.
  // The JsonStore singleton also caches per plugin name, so every test uses
  // its own plugin name to stay isolated.
  const backing = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => backing.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        backing.set(key, value);
      },
      clear: (): void => {
        backing.clear();
      },
    } satisfies Partial<Storage>,
  });
});

describe("Data", () => {
  it("round-trips falsey and structured values, isolated per plugin", () => {
    const data = new Data();
    data.save("RoundTripA", "count", 0);
    data.save("RoundTripA", "flag", false);
    data.save("RoundTripA", "text", "");
    data.save("RoundTripA", "obj", { a: [1, 2] });

    expect(data.load("RoundTripA", "count")).toBe(0);
    expect(data.load("RoundTripA", "flag")).toBe(false);
    expect(data.load("RoundTripA", "text")).toBe("");
    expect(data.load("RoundTripA", "obj")).toEqual({ a: [1, 2] });

    expect(data.load("RoundTripB", "count")).toBeUndefined();
    expect(data.load("RoundTripA", "missing")).toBeUndefined();
  });

  it("treats saving undefined as a no-op, but delete removes", () => {
    const data = new Data();
    data.save("UndefinedSave", "key", "value");
    data.save("UndefinedSave", "key", undefined);
    expect(data.load("UndefinedSave", "key")).toBe("value");

    data.delete("UndefinedSave", "key");
    expect(data.load("UndefinedSave", "key")).toBeUndefined();
  });

  it("recaches from the backing store and reports corruption", async () => {
    const data = new Data();
    data.save("RecacheOk", "key", "before");

    // Externally replace the stored blob, exactly like another context would.
    window.localStorage.setItem("ION_BD_DATA_RecacheOk", JSON.stringify({ key: "after" }));
    await expect(data.recache("RecacheOk")).resolves.toBe(true);
    expect(data.load("RecacheOk", "key")).toBe("after");

    window.localStorage.setItem("ION_BD_DATA_RecacheBad", "{not json");
    await expect(data.recache("RecacheBad")).resolves.toBe(false);
    expect(data.load("RecacheBad", "key")).toBeUndefined();
  });
});

describe("BoundData", () => {
  it("scopes save/load/delete/recache to the plugin name", async () => {
    const bound = new BoundData("BoundPlugin");
    bound.save("key", 123);

    expect(bound.load<number>("key")).toBe(123);
    await expect(bound.recache()).resolves.toBe(true);
    expect(bound.load<number>("key")).toBe(123);

    bound.delete("key");
    expect(bound.load("key")).toBeUndefined();

    // The unbound surface with another name never sees this plugin's data.
    expect(new Data().load("OtherPlugin", "key")).toBeUndefined();
  });
});
