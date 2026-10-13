// @vitest-environment happy-dom
/**
 * Unit tests for the theme engine: registration and identity rules,
 * enablement persistence through the settings store, DOM injection, and
 * the boot contract (register early, apply after settings load).
 */

// The store's contract IS console output for unknown addons: these tests
// spy on the logger's console calls to prove the warning happens.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonTheme, ShellFileApi } from "./platform/shell";
import { createSettingsStore, type SettingsStore } from "./settings";
import {
  createThemeStore,
  syncThemeDirectory,
  watchThemesDir,
  type ThemeRead,
  type ThemeStore,
} from "./themes";

const SETTINGS_PATH = "settings/core.json";

function fakeFiles(initial: Record<string, unknown> | undefined): ShellFileApi {
  const content =
    initial === undefined
      ? undefined
      : `${JSON.stringify({ version: 1, values: initial }, null, 2)}\n`;
  return {
    readFile(path) {
      if (content === undefined || path !== SETTINGS_PATH) {
        return Promise.reject(new Error(`missing ${path}`));
      }
      return Promise.resolve(content);
    },
    writeFile() {
      // Theme tests only need in-memory settings.
      return Promise.resolve();
    },
    readdir() {
      return Promise.reject(new Error("not exercised"));
    },
    mkdir() {
      return Promise.reject(new Error("not exercised"));
    },
    exists(path) {
      return Promise.resolve(content !== undefined && path === SETTINGS_PATH);
    },
    watch() {
      // Theme tests that exercise hot reload install their own fake below.
      return () => undefined;
    },
  };
}

async function fixture(
  initialSettings?: Record<string, unknown>,
): Promise<{ store: ThemeStore; settings: SettingsStore }> {
  const settings = createSettingsStore(fakeFiles(initialSettings));
  await settings.load();
  return { store: createThemeStore({ settings }), settings };
}

function theme(id: string, extra: Partial<IonTheme> = {}): IonTheme {
  return {
    id,
    name: id,
    description: `${id} test theme`,
    filename: `${id}.css`,
    css: `/* ${id} */`,
    ...extra,
  };
}

/** Ids of every injected theme style, in document order. */
function styleIds(): string[] {
  return [...document.head.querySelectorAll("style[data-ion-theme]")].map(
    (element) => element.getAttribute("data-ion-theme") ?? "",
  );
}

beforeEach(() => {
  for (const element of document.head.querySelectorAll("style")) element.remove();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createThemeStore", () => {
  it("applies persisted enablement at boot", async () => {
    const { store } = await fixture({ "themes.enabled.off": false });
    store.register(theme("on"));
    store.register(theme("off"));

    store.boot();

    // Registered themes default to enabled; `off` was persisted disabled.
    expect(styleIds()).toEqual(["on"]);
    expect(store.isEnabled("on")).toBe(true);
    expect(store.isEnabled("off")).toBe(false);
  });

  it("injects styles for registrations that arrive after boot", async () => {
    const { store } = await fixture();
    store.boot();

    store.register(theme("late"));

    expect(styleIds()).toEqual(["late"]);
    const style = document.head.querySelector('style[data-ion-theme="late"]');
    expect(style?.textContent).toBe("/* late */");
  });

  it("keeps a theme registered before boot unstyled until boot", async () => {
    const { store } = await fixture();

    store.register(theme("early"));
    expect(styleIds()).toEqual([]);

    store.boot();
    expect(styleIds()).toEqual(["early"]);
  });

  it("moves the style element when toggled and persists the choice", async () => {
    const { store, settings } = await fixture();
    store.register(theme("t"));
    store.boot();
    expect(styleIds()).toEqual(["t"]);

    expect(store.setEnabled("t", false)).toBe(true);
    expect(styleIds()).toEqual([]);
    expect(settings.get("themes.enabled.t", true)).toBe(false);

    expect(store.setEnabled("t", true)).toBe(true);
    expect(styleIds()).toEqual(["t"]);
    expect(settings.get("themes.enabled.t", true)).toBe(true);
  });

  it("resolves by id, name, and filename", async () => {
    const { store } = await fixture();
    const registered = theme("bd.Alpha", {
      name: "Alpha",
      filename: "Alpha.theme.css",
    });
    store.register(registered);

    expect(store.get("bd.Alpha")).toBe(registered);
    expect(store.get("Alpha")).toBe(registered);
    expect(store.get("Alpha.theme.css")).toBe(registered);
    expect(store.get("nope")).toBeUndefined();
    expect(store.isEnabled("Alpha")).toBe(true);
    expect(store.isEnabled("nope")).toBe(false);
  });

  it("rejects duplicate and invalid identities", async () => {
    const { store } = await fixture();

    store.register(theme("a"));
    expect(() => {
      store.register(theme("a"));
    }).toThrow("theme id already registered: a");
    expect(() => {
      store.register({ ...theme("b"), name: "a" });
    }).toThrow("theme name already registered: a");
    expect(() => {
      store.register(theme("has space"));
    }).toThrow("theme id must be a non-empty token");
    expect(() => {
      store.register(theme("c", { name: "  " }));
    }).toThrow("theme name must be a non-empty string");
  });

  it("unregisters without losing persisted enablement", async () => {
    const { store, settings } = await fixture();
    store.register(theme("x"));
    store.boot();
    store.setEnabled("x", false);

    expect(store.unregister("x")).toBe(true);
    expect(store.unregister("x")).toBe(false);
    expect(store.list()).toEqual([]);
    expect(styleIds()).toEqual([]);

    // Re-registering the same id restores the persisted state.
    store.register(theme("x"));
    expect(store.isEnabled("x")).toBe(false);
    expect(styleIds()).toEqual([]);
    expect(settings.get("themes.enabled.x", true)).toBe(false);
  });

  it("lists identity plus live enablement", async () => {
    const { store } = await fixture();
    store.register(
      theme("bd.Theme", {
        name: "Theme",
        description: "A theme",
        authors: ["Tester"],
        version: "2.0.0",
        filename: "Theme.theme.css",
        css: "body {}",
      }),
    );
    store.boot();
    store.setEnabled("bd.Theme", false);

    expect(store.list()).toEqual([
      {
        id: "bd.Theme",
        name: "Theme",
        description: "A theme",
        authors: ["Tester"],
        version: "2.0.0",
        filename: "Theme.theme.css",
        enabled: false,
      },
    ]);
  });

  it("defaults missing authors to an empty list", async () => {
    const { store } = await fixture();
    store.register(theme("plain"));

    expect(store.list()[0]?.authors).toEqual([]);
  });

  it("returns false for setEnabled on an unknown theme", async () => {
    const { store } = await fixture();

    expect(store.setEnabled("ghost", true)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      "[ion] [themes]",
      expect.stringContaining("unknown theme"),
    );
  });

  it("notifies subscribers on register, boot, and toggle; unsubscribe stops", async () => {
    const { store } = await fixture();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.register(theme("n"));
    expect(listener).toHaveBeenCalledTimes(1);
    store.boot();
    expect(listener).toHaveBeenCalledTimes(2);
    store.setEnabled("n", false);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    store.setEnabled("n", true);
    store.unregister("n");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does not notify when enablement did not change", async () => {
    const { store } = await fixture();
    store.register(theme("same"));
    store.boot();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.setEnabled("same", true)).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });
});

// -- Directory ingestion and hot reload ------------------------------------

const DIR = "tests/themes";

/** A stand-in adapter reader: a file without the marker is unusable. */
async function readTheme(files: ShellFileApi, filename: string): Promise<ThemeRead> {
  const source = await files.readFile(`${DIR}/${filename}`, "utf8");
  if (!source.startsWith("/*")) return { ok: false, reason: "not a theme" };
  return {
    ok: true,
    theme: {
      id: `test.${filename.replace(/\W+/g, "_")}`,
      name: filename.replace(/\.css$/, ""),
      description: "directory theme",
      authors: [filename],
      filename,
      css: source,
    },
  };
}

interface DirectoryFixture {
  readonly store: ThemeStore;
  readonly settings: SettingsStore;
  readonly files: ShellFileApi;
  /** The files on disk, so a test can edit or remove one. */
  readonly onDisk: Map<string, string>;
  /** Reports a change to every live subscription. */
  notify(): void;
  /** Whether the last subscription was released. */
  unsubscribed(): boolean;
}

async function directoryFixture(entries: Record<string, string> = {}): Promise<DirectoryFixture> {
  const { store, settings } = await fixture();
  const onDisk = new Map(Object.entries(entries).map(([n, c]) => [`${DIR}/${n}`, c]));
  const listeners = new Set<(changed: readonly string[]) => void>();
  let unsubscribed = false;

  const files: ShellFileApi = {
    readFile(path) {
      const content = onDisk.get(path);
      return content === undefined
        ? Promise.reject(new Error(`missing ${path}`))
        : Promise.resolve(content);
    },
    writeFile(path, data) {
      onDisk.set(path, data);
      return Promise.resolve();
    },
    readdir(path) {
      if (path !== DIR) return Promise.reject(new Error(`missing ${path}`));
      const prefix = `${DIR}/`;
      return Promise.resolve([...onDisk.keys()].map((key) => key.slice(prefix.length)).sort());
    },
    mkdir() {
      return Promise.resolve();
    },
    exists(path) {
      return Promise.resolve(onDisk.has(path));
    },
    watch(_path, onChanged) {
      listeners.add(onChanged);
      return () => {
        unsubscribed = true;
        listeners.clear();
      };
    },
  };

  return {
    store,
    settings,
    files,
    onDisk,
    notify() {
      for (const listener of listeners) listener([]);
    },
    unsubscribed: () => unsubscribed,
  };
}

describe("syncThemeDirectory", () => {
  it("loads the directory in order and reports what it skipped", async () => {
    const { store, files } = await directoryFixture({
      "B.theme.css": "/* theme b */",
      "A.theme.css": "/* theme a */",
      "notes.txt": "not a theme",
    });

    const result = await syncThemeDirectory({
      store,
      files,
      dir: DIR,
      readTheme,
      registered: new Map(),
    });

    if (!result.ok) throw new Error("expected a successful sync");
    expect(result.loaded).toEqual(["test.A_theme_css", "test.B_theme_css"]);
    expect(result.skipped).toEqual([{ filename: "notes.txt", reason: "not a theme" }]);
    expect(store.list().map((info) => info.id)).toEqual(result.loaded);
  });

  it("reports a directory it cannot list", async () => {
    const { store } = await fixture();

    const result = await syncThemeDirectory({
      store,
      files: fakeFiles(undefined),
      dir: DIR,
      readTheme,
      registered: new Map(),
    });

    if (result.ok) throw new Error("expected a failed sync");
    expect(result.reason).toBe("not exercised");
  });

  it("unregisters a file that is gone", async () => {
    const registered = new Map<string, string>();
    const { store, files, onDisk } = await directoryFixture({ "A.theme.css": "/* theme a */" });
    await syncThemeDirectory({ store, files, dir: DIR, readTheme, registered });

    onDisk.delete(`${DIR}/A.theme.css`);
    const result = await syncThemeDirectory({ store, files, dir: DIR, readTheme, registered });

    expect(result).toEqual({ ok: true, loaded: [], skipped: [], removed: ["test.A_theme_css"] });
    expect(store.list()).toEqual([]);
  });

  it("re-reads a changed file and keeps its persisted enablement", async () => {
    const registered = new Map<string, string>();
    const { store, settings, files } = await directoryFixture({ "A.theme.css": "/* theme a */" });
    await syncThemeDirectory({ store, files, dir: DIR, readTheme, registered });
    store.boot();
    store.setEnabled("test.A_theme_css", false);

    await files.writeFile(`${DIR}/A.theme.css`, "/* theme a, edited */");
    const result = await syncThemeDirectory({ store, files, dir: DIR, readTheme, registered });

    // A re-read swaps records; the enablement key lives outside the record.
    if (!result.ok) throw new Error("expected a successful sync");
    expect(result.loaded).toEqual(["test.A_theme_css"]);
    expect(store.get("A.theme.css")?.css).toBe("/* theme a, edited */");
    expect(store.isEnabled("A.theme.css")).toBe(false);
    expect(settings.get("themes.enabled.test.A_theme_css", true)).toBe(false);
  });

  it("leaves a theme alone when nothing about it changed", async () => {
    const registered = new Map<string, string>();
    const { store, files } = await directoryFixture({ "A.theme.css": "/* theme a */" });
    await syncThemeDirectory({ store, files, dir: DIR, readTheme, registered });
    const listener = vi.fn();
    store.subscribe(listener);

    const result = await syncThemeDirectory({ store, files, dir: DIR, readTheme, registered });

    // An unrelated save in the same directory fires the watcher too; nothing
    // moved, so the store is not touched.
    if (!result.ok) throw new Error("expected a successful sync");
    expect(result.loaded).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps a running theme when its file stops parsing", async () => {
    const registered = new Map<string, string>();
    const { store, files } = await directoryFixture({ "A.theme.css": "/* theme a */" });
    await syncThemeDirectory({ store, files, dir: DIR, readTheme, registered });

    await files.writeFile(`${DIR}/A.theme.css`, "half-written");
    const result = await syncThemeDirectory({ store, files, dir: DIR, readTheme, registered });

    if (!result.ok) throw new Error("expected a successful sync");
    expect(result.skipped).toEqual([{ filename: "A.theme.css", reason: "not a theme" }]);
    expect(store.get("A.theme.css")?.css).toBe("/* theme a */");
  });

  it("ignores entries the directory does not accept", async () => {
    const { store, files } = await directoryFixture({ "A.theme.css": "/* theme a */" });

    const result = await syncThemeDirectory({
      store,
      files,
      dir: DIR,
      readTheme,
      accepts: (filename) => filename.startsWith("A."),
      registered: new Map(),
    });

    expect(result).toEqual({ ok: true, loaded: ["test.A_theme_css"], skipped: [], removed: [] });
  });

  it("isolates a reader that throws", async () => {
    const { store, files } = await directoryFixture({ "A.theme.css": "/* theme a */" });

    const result = await syncThemeDirectory({
      store,
      files,
      dir: DIR,
      readTheme: () => Promise.reject(new Error("reader exploded")),
      registered: new Map(),
    });

    if (!result.ok) throw new Error("expected a successful sync");
    expect(result.skipped).toEqual([{ filename: "A.theme.css", reason: "reader exploded" }]);
    expect(store.list()).toEqual([]);
  });
});

describe("watchThemesDir", () => {
  it("coalesces a burst of notifications into one reconcile", async () => {
    vi.useFakeTimers();
    const watchers = await directoryFixture({ "A.theme.css": "/* theme a */" });
    const reconcile = vi.fn(() => Promise.resolve());
    const unwatch = watchThemesDir({ files: watchers.files, dir: DIR, reconcile });

    watchers.notify();
    watchers.notify();
    watchers.notify();
    expect(reconcile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);

    expect(reconcile).toHaveBeenCalledTimes(1);
    unwatch();
    expect(watchers.unsubscribed()).toBe(true);
  });

  it("reports a reconcile that fails without stopping the watcher", async () => {
    vi.useFakeTimers();
    const watchers = await directoryFixture();
    const unwatch = watchThemesDir({
      files: watchers.files,
      dir: DIR,
      reconcile: () => Promise.reject(new Error("disk gone")),
    });

    watchers.notify();
    await vi.advanceTimersByTimeAsync(150);

    expect(console.warn).toHaveBeenCalledWith(
      "[ion] [themes]",
      expect.stringContaining("reload after a file change failed"),
    );
    unwatch();
  });

  it("degrades to a no-op when the shell cannot watch", async () => {
    const { store } = await fixture();
    const files: ShellFileApi = {
      ...fakeFiles(undefined),
      watch() {
        throw new Error("ENOSPC: inotify watch limit reached");
      },
    };

    const unwatch = watchThemesDir({
      files,
      dir: DIR,
      reconcile: () => {
        // Nothing to reconcile: the point is that a shell which cannot watch
        // still hands back a callable unsubscribe.
      },
    });

    // Nothing was ever subscribed, so releasing is a no-op rather than a
    // throw — the adapter keeps the load it already has.
    unwatch();
    expect(console.warn).toHaveBeenCalledWith(
      "[ion] [themes]",
      expect.stringContaining("hot reload is off"),
    );
    expect(store.list()).toEqual([]);
  });
});

describe("the documented theme variables", () => {
  it("installs the base style exactly once per store", async () => {
    await fixture();

    const styles = document.head.querySelectorAll("style[data-ion-theme-base]");
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain("--ion-theme-background");

    // A second store replaces the element rather than stacking another.
    await fixture();
    expect(document.head.querySelectorAll("style[data-ion-theme-base]")).toHaveLength(1);
  });
});

/**
 * The core bundle is injected before Discord's first script, so at the moment
 * the adapters build their theme host the parser has produced neither a
 * `<head>` nor an `<html>`. This is the regression: the engine read
 * `document.querySelector("head") ?? document.documentElement`, which is null
 * there, and the first style install threw "Cannot read properties of null
 * (reading 'querySelector')" — killing the whole injection, which left the
 * client with no core, no discovery and no plugins.
 */
describe("a document with no element yet (document-start)", () => {
  let originalHtml: HTMLElement;
  let originalHead: HTMLElement | null;
  let restore: () => void;

  beforeEach(() => {
    originalHtml = document.documentElement;
    originalHead = document.head;
    Object.defineProperty(document, "head", { value: null, configurable: true });
    Object.defineProperty(document, "documentElement", { value: null, configurable: true });
    restore = () => {
      Object.defineProperty(document, "head", { value: originalHead, configurable: true });
      Object.defineProperty(document, "documentElement", {
        value: originalHtml,
        configurable: true,
      });
    };
  });

  afterEach(() => {
    restore();
  });

  it("builds a store without throwing, and installs once the document grows", async () => {
    const { store } = await fixture();

    // Registering and booting while the document is empty must not touch the
    // DOM at all: nothing is lost, only deferred.
    store.register(theme("early"));
    store.boot();
    expect(document.querySelectorAll("style")).toHaveLength(0);

    // The document finally exists — and it is the document's own root, not a
    // detached one, or the appended styles would be invisible to it. Assigning
    // directly is refused (`documentElement` is a read-only accessor), and
    // defining it is what the parser does anyway.
    Object.defineProperty(document, "documentElement", {
      value: originalHtml,
      configurable: true,
    });
    document.dispatchEvent(new Event("readystatechange"));

    expect(document.querySelectorAll("style[data-ion-theme-base]")).toHaveLength(1);
    expect(document.querySelectorAll('style[data-ion-theme="early"]')).toHaveLength(1);
  });
});
