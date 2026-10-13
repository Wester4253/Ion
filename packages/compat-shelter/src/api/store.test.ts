/**
 * `shelter.plugin.store`, the plugin-facing half.
 *
 * The regression that matters: a store handed to a plugin must accept
 * `store[key] = value`, `store[key] ??= default`, nested writes and array
 * pushes — the ways plugins in the wild seed themselves — and a read after
 * any of those must see the value. Solid's own store proxy fails every one
 * of them by silently dropping the write; see the file header in `store.ts`.
 *
 * Writes use element access rather than dots: `PluginStore`'s index signature
 * makes `store.key` a type error here, exactly as it is for a plugin.
 */
import { createEffect, createRoot } from "solid-js";
import { describe, expect, test, vi } from "vitest";

import { createPluginStore, type PluginStore } from "./store";

/** Read one key out of a store, typed as a plugin would read it. */
function read(store: PluginStore, key: string): unknown {
  return store[key];
}

/** Read one key as a nested object, as a plugin casts its own settings. */
function readObject(store: PluginStore, key: string): Record<string, unknown> {
  return read(store, key) as Record<string, unknown>;
}

/** Read one key as an array, as a plugin iterates its own lists. */
function readArray(store: PluginStore, key: string): unknown[] {
  return read(store, key) as unknown[];
}

describe("createPluginStore", () => {
  test("a write at the root lands and is readable", () => {
    const handle = createPluginStore({});
    handle.store["watchedGuilds"] = [];

    expect(Array.isArray(read(handle.store, "watchedGuilds"))).toBe(true);
    expect(read(handle.store, "watchedGuilds")).toEqual([]);
  });

  test("`??=` seeds an absent key instead of being dropped", () => {
    const handle = createPluginStore({});

    handle.store["users"] ??= [];

    expect(readArray(handle.store, "users")).toEqual([]);
  });

  test("a nested write is addressed by path, not as a reassignment", () => {
    const handle = createPluginStore({ nested: { keep: 1 } });

    readObject(handle.store, "nested")["deeper"] = 2;

    expect(readObject(handle.store, "nested")).toEqual({ keep: 1, deeper: 2 });
  });

  test("an array can be pushed to and then iterated", () => {
    const handle = createPluginStore({ keybinds: [] });

    readArray(handle.store, "keybinds").push({ id: 1 });
    readArray(handle.store, "keybinds").push({ id: 2 });

    expect(readArray(handle.store, "keybinds")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(readArray(handle.store, "keybinds").length).toBe(2);
  });

  test("an index write on an array lands", () => {
    const handle = createPluginStore({ keybinds: [{ id: 1 }] });

    (readArray(handle.store, "keybinds")[0] as { id: number }).id = 9;

    expect(readArray(handle.store, "keybinds")).toEqual([{ id: 9 }]);
  });

  test("deleting a key removes it", () => {
    const handle = createPluginStore({ doomed: 1, kept: 2 });

    delete handle.store["doomed"];

    expect("doomed" in handle.store).toBe(false);
    expect(read(handle.store, "kept")).toBe(2);
  });

  test("a write is not silently dropped: no mutation warning from Solid", () => {
    // The failure mode this whole module exists for: solid's read-only proxy
    // answer. If a future change routes writes back to it, this fails loudly
    // instead of dropping every plugin's seeded store.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handle = createPluginStore({});

    handle.store["packs"] = ["a"];

    expect(readArray(handle.store, "packs")).toEqual(["a"]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("a read stays reactive: a component re-runs when a plugin writes", () => {
    const handle = createPluginStore({ label: "first" });
    const seen: string[] = [];

    const stop = createRoot((dispose) => {
      createEffect(() => seen.push(read(handle.store, "label") as string));
      return dispose;
    });

    // The effect ran once when the root settled, before anything was written.
    expect(seen).toEqual(["first"]);

    handle.store["label"] = "second";

    expect(seen).toEqual(["first", "second"]);
    stop();
  });

  test("snapshot serializes everything written, including new keys", () => {
    const handle = createPluginStore({ existing: true });

    handle.store["fresh"] = [1, 2, 3];
    handle.store["nested"] = { a: 1 };

    expect(JSON.parse(JSON.stringify(handle.snapshot()))).toEqual({
      existing: true,
      fresh: [1, 2, 3],
      nested: { a: 1 },
    });
  });

  test("a value written from another store's proxy does not leak that proxy", () => {
    const a = createPluginStore({ shared: { from: "a" } });
    const b = createPluginStore({});

    b.store["mirror"] = a.store["shared"];

    expect(read(b.snapshot(), "mirror")).toEqual({ from: "a" });
    expect(Object.getPrototypeOf(read(b.snapshot(), "mirror"))).toBe(Object.prototype);
  });
});
