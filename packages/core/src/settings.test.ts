import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShellFileApi } from "./platform/shell";
import { createSettingsStore, type SettingsStore } from "./settings";

const SETTINGS_PATH = "settings/core.json";

interface FakeFiles {
  readonly api: ShellFileApi;
  readonly files: Map<string, string>;
}

function fakeFiles(initial: Record<string, string> = {}): FakeFiles {
  const files = new Map(Object.entries(initial));
  const api: ShellFileApi = {
    readFile(path) {
      const content = files.get(path);
      if (content === undefined) return Promise.reject(new Error(`missing ${path}`));
      return Promise.resolve(content);
    },
    writeFile(path, data) {
      files.set(path, data);
      return Promise.resolve();
    },
    readdir() {
      return Promise.reject(new Error("not exercised by the settings store"));
    },
    mkdir() {
      return Promise.reject(new Error("not exercised by the settings store"));
    },
    exists(path) {
      return Promise.resolve(files.has(path));
    },
    watch() {
      // The settings store never hot-reloads; adapters need this method to
      // exist because the bridge declares it.
      return () => undefined;
    },
  };
  return { api, files };
}

function persisted(values: Record<string, unknown>): string {
  return `${JSON.stringify({ version: 1, values }, null, 2)}\n`;
}

async function loadStore(files: FakeFiles): Promise<SettingsStore> {
  const store = createSettingsStore(files.api);
  await store.load();
  return store;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createSettingsStore", () => {
  it("starts with defaults when no file exists", async () => {
    const store = await loadStore(fakeFiles());
    expect(store.get("plugins.enabled.example", true)).toBe(true);
    expect(store.get("missing", "fallback")).toBe("fallback");
  });

  it("merges persisted values over defaults", async () => {
    const files = fakeFiles({
      [SETTINGS_PATH]: persisted({ "plugins.enabled.example": false, other: 7 }),
    });
    const store = await loadStore(files);
    expect(store.get("plugins.enabled.example", true)).toBe(false);
    expect(store.get("other", 0)).toBe(7);
    expect(store.get("never-set", "default")).toBe("default");
  });

  it("stays on defaults when the file is unreadable", async () => {
    const files = fakeFiles({ [SETTINGS_PATH]: "{not json" });
    const store = await loadStore(files);
    expect(store.get("anything", 1)).toBe(1);
  });

  it("stays on defaults when the shape is unrecognized", async () => {
    const files = fakeFiles({ [SETTINGS_PATH]: '{"version":1}' });
    const store = await loadStore(files);
    expect(store.get("anything", "x")).toBe("x");
  });

  it("loads values written by a newer format version anyway", async () => {
    const files = fakeFiles({
      [SETTINGS_PATH]: JSON.stringify({ version: 99, values: { future: "key" } }),
    });
    const store = await loadStore(files);
    expect(store.get("future", "")).toBe("key");
  });

  it("shares one read across concurrent loads", async () => {
    const files = fakeFiles({ [SETTINGS_PATH]: persisted({ a: 1 }) });
    const store = createSettingsStore(files.api);
    await Promise.all([store.load(), store.load(), store.load()]);
    expect(store.get("a", 0)).toBe(1);
  });

  it("persists after the debounce and coalesces rapid changes", async () => {
    vi.useFakeTimers();
    const files = fakeFiles();
    const store = await loadStore(files);
    store.set("greeting", "hi");
    store.set("greeting", "hello");
    expect(files.files.has(SETTINGS_PATH)).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(files.files.get(SETTINGS_PATH)).toBe(persisted({ greeting: "hello" }));
  });

  it("writes immediately on persistNow and treats the pending timer as a no-op", async () => {
    vi.useFakeTimers();
    const files = fakeFiles();
    const store = await loadStore(files);
    store.set("a", 1);
    await store.persistNow();
    expect(files.files.get(SETTINGS_PATH)).toBe(persisted({ a: 1 }));
    await vi.advanceTimersByTimeAsync(500);
    expect(files.files.get(SETTINGS_PATH)).toBe(persisted({ a: 1 }));
  });

  it("notifies subscribers on set and delete, and stops after unsubscribe", async () => {
    const store = await loadStore(fakeFiles());
    const seen: [string, unknown][] = [];
    const unsubscribe = store.subscribe((key, value) => seen.push([key, value]));
    store.set("alpha", 1);
    store.delete("alpha");
    unsubscribe();
    store.set("beta", 2);
    expect(seen).toEqual([
      ["alpha", 1],
      ["alpha", undefined],
    ]);
  });

  it("skips notification and writes for JSON-equal values", async () => {
    vi.useFakeTimers();
    const files = fakeFiles();
    const store = await loadStore(files);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set("obj", { a: [1, 2] });
    store.set("obj", { a: [1, 2] });
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(files.files.get(SETTINGS_PATH)).toBe(persisted({ obj: { a: [1, 2] } }));
  });

  it("rejects whitespace keys, empty keys, and non-serializable values", async () => {
    const store = await loadStore(fakeFiles());
    expect(() => {
      store.set("", 1);
    }).toThrow(TypeError);
    expect(() => {
      store.set("has space", 1);
    }).toThrow(TypeError);
    expect(() => {
      store.set("fn", () => 1);
    }).toThrow(TypeError);
    expect(() => {
      store.set("undef", undefined);
    }).toThrow(TypeError);
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => {
      store.set("cycle", circular);
    }).toThrow(TypeError);
  });

  it("falls back when a persisted primitive disagrees with the default type", async () => {
    const files = fakeFiles({ [SETTINGS_PATH]: persisted({ flag: "yes" }) });
    const store = await loadStore(files);
    expect(store.get("flag", true)).toBe(true);
  });

  it("accepts object defaults without structural validation", async () => {
    const files = fakeFiles({ [SETTINGS_PATH]: persisted({ shape: { custom: 1 } }) });
    const store = await loadStore(files);
    expect(store.get("shape", { fallback: true })).toEqual({ custom: 1 });
  });

  it("scopes namespace get/set/delete/subscribe", async () => {
    const store = await loadStore(fakeFiles());
    const scoped = store.namespace("plugin.demo");
    scoped.set("color", "red");
    expect(scoped.get("color", "")).toBe("red");
    expect(store.get("plugin.demo.color", "")).toBe("red");

    const seen: [string, unknown][] = [];
    const stopForeign = store.subscribe((key, value) => seen.push([`outer:${key}`, value]));
    const stopScoped = scoped.subscribe((key, value) => seen.push([key, value]));
    scoped.set("color", "blue");
    store.set("unrelated", 1);
    scoped.delete("color");
    stopForeign();
    stopScoped();

    expect(scoped.get("color", "none")).toBe("none");
    expect(seen).toEqual([
      ["outer:plugin.demo.color", "blue"],
      ["color", "blue"],
      ["outer:unrelated", 1],
      ["outer:plugin.demo.color", undefined],
      ["color", undefined],
    ]);
  });

  it("keeps changes in memory and retries after a failed write", async () => {
    vi.useFakeTimers();
    let failNext = true;
    const files = fakeFiles();
    const api: ShellFileApi = {
      ...files.api,
      writeFile(path, data) {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error("disk full"));
        }
        return files.api.writeFile(path, data);
      },
    };
    const store = createSettingsStore(api);
    await store.load();
    store.set("a", 1);
    await vi.advanceTimersByTimeAsync(200);
    expect(files.files.has(SETTINGS_PATH)).toBe(false);
    store.set("b", 2); // marks dirty again, carrying the failed value along
    await vi.advanceTimersByTimeAsync(200);
    expect(files.files.get(SETTINGS_PATH)).toBe(persisted({ a: 1, b: 2 }));
  });
});
