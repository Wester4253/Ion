import { describe, expect, it } from "vitest";

import { filters } from "./filters";
import { findAllInCache, findInCache, type ModuleCache } from "./find";

function makeCache(): ModuleCache {
  return {
    1: { id: 1, loaded: true, exports: { getCurrentUser: () => "user" } },
    2: { id: 2, loaded: false, exports: { getCurrentUser: () => "not ready" } },
    3: { id: 3, loaded: true, exports: { nested: { deep: true } } },
    4: { id: 4, loaded: true, exports: null },
  };
}

describe("findInCache", () => {
  it("finds loaded top-level matches and reports their id", () => {
    const found = findInCache(makeCache(), filters.byProps("getCurrentUser"));
    expect(found).toMatchObject({ id: "1" });
    expect((found?.exports as { getCurrentUser: () => string }).getCurrentUser()).toBe("user");
  });

  it("skips unloaded entries", () => {
    const found = findInCache(makeCache(), filters.byProps("getCurrentUser"));
    expect(found?.id).not.toBe("2");
  });

  it("descends into nested exports by default", () => {
    const found = findInCache(makeCache(), filters.byProps("deep"));
    expect(found).toMatchObject({ id: "3", exports: { deep: true } });
  });

  it("stays top-level with topLevelOnly", () => {
    expect(
      findInCache(makeCache(), filters.byProps("deep"), { topLevelOnly: true }),
    ).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(findInCache(makeCache(), filters.byProps("missing"))).toBeUndefined();
  });

  it("treats a throwing getter as a miss instead of failing", () => {
    const poisoned = Object.defineProperty({ visible: true }, "boom", {
      enumerable: true,
      get(): never {
        throw new Error("poisoned getter");
      },
    });
    const cache: ModuleCache = { 1: { id: 1, loaded: true, exports: poisoned } };

    expect(() => findInCache(cache, filters.byProps("missing"))).not.toThrow();
    expect(findInCache(cache, filters.byProps("missing"))).toBeUndefined();
    expect(findInCache(cache, filters.byProps("visible"))?.exports).toBe(poisoned);
  });
});

describe("findAllInCache", () => {
  it("collects every top-level and nested match", () => {
    const cache: ModuleCache = {
      1: { id: 1, loaded: true, exports: { alpha: { shared: 1 } } },
      2: { id: 2, loaded: true, exports: { beta: { shared: 2 } } },
    };

    expect(findAllInCache(cache, filters.byProps("shared"))).toHaveLength(2);
    expect(findAllInCache(cache, filters.byProps("shared"), { topLevelOnly: true })).toEqual([]);
  });
});
