// @vitest-environment happy-dom
/**
 * Unit tests for the `BdApi.Utils` surface: the tree walker, deep extend,
 * debounce, escapeHTML, clsx-style classNames, nested access, semver
 * comparison, mapObject, the memoizing cache (including its lazy proxy),
 * and the exported Store base class.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { Utils } from "./utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findInTree", () => {
  const tree = { a: { b: { found: "yes" } }, list: [1, { found: "list" }] };

  it("finds by filter, deepest-first through arrays and objects", () => {
    const result = Utils.findInTree(tree, (value) => {
      return typeof value === "object" && value !== null && "found" in value;
    });
    expect(result).toBe(tree.a.b);
  });

  it("finds by direct key", () => {
    expect(Utils.findInTree(tree, "found")).toBe("yes");
  });

  it("honors walkable and ignore", () => {
    expect(Utils.findInTree(tree, "found", { walkable: ["list"] })).toBe("list");
    expect(Utils.findInTree(tree, "found", { ignore: ["a"] })).toBe("list");
  });

  it("returns undefined when nothing matches", () => {
    expect(Utils.findInTree(tree, "missing")).toBeUndefined();
    expect(Utils.findInTree("primitive", "missing")).toBeUndefined();
  });
});

describe("extend", () => {
  it("deep-merges in order, later extenders winning", () => {
    const target = { a: 1, nested: { x: 1, deep: { y: 1 } }, arr: [1, 2] };
    const result = Utils.extend(target, { b: 2 }, { nested: { x: 2, deep: { z: 3 } }, arr: [3] });

    expect(result).toBe(target);
    expect(target).toEqual({
      a: 1,
      b: 2,
      nested: { x: 2, deep: { y: 1, z: 3 } },
      arr: [3],
    });
  });

  it("overwrites objects with primitives and primitives with fresh objects", () => {
    const target = { a: { b: 1 } as unknown, c: 5 as unknown };
    Utils.extend(target, { a: 5 }, { c: { d: 1 } });
    expect(target.a).toBe(5);
    expect(target.c).toEqual({ d: 1 });
  });

  it("deep-clones arrays so later mutation of the source does not leak", () => {
    const source = { arr: [{ v: 1 }] };
    const target = { arr: [] as { v: number }[] };
    Utils.extend(target, source);

    const first = source.arr[0];
    if (first) first.v = 2;

    expect(target.arr[0]).toEqual({ v: 1 });
  });

  it("requires at least one extender", () => {
    expect(() => Utils.extend({})).toThrow("Needs at least 1 extenders");
  });
});

describe("debounce", () => {
  it("collapses rapid calls into one trailing invocation", () => {
    vi.useFakeTimers();
    try {
      const calls: number[] = [];
      const debounced = Utils.debounce((value: number) => {
        calls.push(value);
      }, 100);

      debounced(1);
      debounced(2);
      debounced(3);
      expect(calls).toEqual([]);

      vi.advanceTimersByTime(99);
      expect(calls).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(calls).toEqual([3]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("escapeHTML and className", () => {
  it("escapes HTML through the browser's own mechanism", () => {
    const escaped = Utils.escapeHTML("<b onclick=\"alert('x')\">&amp;</b>");
    expect(escaped).toContain("&lt;b");
    expect(escaped).not.toContain("<b");
  });

  it("joins strings, arrays, and truthy object keys like clsx", () => {
    expect(Utils.className("a", { b: true, c: false }, ["d", ["e", null, "f"]])).toBe("a b d e f");
    expect(Utils.className()).toBe("");
  });
});

describe("getNestedValue", () => {
  const source = { a: { b: [{ id: 7 }] } };

  it("walks dotted paths including array indices", () => {
    expect(Utils.getNestedValue(source, "a.b.0.id")).toBe(7);
  });

  it("returns undefined for missing paths and the object for empty paths", () => {
    expect(Utils.getNestedValue(source, "a.missing")).toBeUndefined();
    expect(Utils.getNestedValue(source, "")).toBe(source);
  });
});

describe("semverCompare", () => {
  it("compares major.minor.patch with 0 equal, -1 left greater, 1 right greater", () => {
    expect(Utils.semverCompare("1.0.0", "1.0.0")).toBe(0);
    expect(Utils.semverCompare("2.0.0", "1.0.0")).toBe(-1);
    expect(Utils.semverCompare("1.0.0", "1.0.1")).toBe(1);
  });

  it("ranks prereleases below their release", () => {
    expect(Utils.semverCompare("1.0.0", "1.0.0-beta")).toBe(-1);
    expect(Utils.semverCompare("1.0.0-beta", "1.0.0")).toBe(1);
  });

  it("treats unparseable versions as equal, like upstream", () => {
    expect(Utils.semverCompare("not a version", "1.0.0")).toBe(0);
  });
});

describe("mapObject", () => {
  it("binds filtered source values to mapped keys", () => {
    const source = {
      SEND: (value: number) => value * 2,
      other: 1,
    };
    const mapped = Utils.mapObject<{ send: (value: number) => number }>(source, {
      send: (value) => typeof value === "function",
    });
    expect(mapped.send(2)).toBe(4);
  });
});

describe("cache", () => {
  it("memoizes the factory and resets", () => {
    let calls = 0;
    const factory = Utils.cache(() => {
      calls++;
      return { calls };
    });

    expect(factory.hasValue()).toBe(false);
    expect(factory()).toBe(factory());
    expect(calls).toBe(1);

    factory.reset();
    factory();
    expect(calls).toBe(2);
  });

  it("exposes a live get and re-runs once CALL_LIMIT is reached", () => {
    let calls = 0;
    const factory = Utils.cache(() => ++calls);

    expect(factory.get).toBe(1);
    expect(factory.get).toBe(1);

    // Upstream compares the pre-increment counter, so the limit is reached
    // on the (limit + 1)th call after the reset.
    factory.CALL_LIMIT = 2;
    expect(factory()).toBe(2);
    expect(factory()).toBe(2);
    expect(factory()).toBe(3);
  });

  it("rejects invalid CALL_LIMIT values", () => {
    const factory = Utils.cache(() => 1);
    expect(() => {
      factory.CALL_LIMIT = 0;
    }).toThrow("Unable to set max call threshold. Value is not a positive int");
  });

  it("defers cache.proxy's factory to first property access", () => {
    let calls = 0;
    const proxied = Utils.cache.proxy(() => {
      calls++;
      return { value: 42 };
    });

    expect(calls).toBe(0);
    expect(proxied.value).toBe(42);
    expect(calls).toBe(1);
    expect(proxied.value).toBe(42);
    expect(calls).toBe(1);
  });
});

describe("Store", () => {
  it("emits changes to listeners until unsubscribed", () => {
    const store = new Utils.Store();
    let changes = 0;
    const unsubscribe = store.addChangeListener(() => {
      changes++;
    });

    store.emitChange();
    expect(changes).toBe(1);

    unsubscribe();
    store.emitChange();
    expect(changes).toBe(1);
  });
});
