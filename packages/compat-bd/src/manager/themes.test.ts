// @vitest-environment happy-dom
/**
 * Unit tests for the BD theme loader: header parsing into store fields,
 * per-file isolation, duplicate-download hints, reload keeping the current
 * theme when a file stops parsing, and hot reload on a reported change.
 */

// The loader's contract IS console output: the compat harness reads it
// back to attribute failures, so these tests spy on it.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared theme engine arrives on the host global at runtime (adapters
// must never bundle core), so the suites install the real one: what is under
// test here is that the adapter drives it with the right directory, reader,
// and bookkeeping — not a second copy of its logic.
import { parseThemeHeader, syncThemeDirectory, watchThemesDir } from "@ion/core";
import {
  fakeThemeStore,
  installShell,
  installThemes,
  type FakeThemeStore,
} from "../testing/fixtures";
import { loadBdThemes, reloadBdTheme, watchBdThemes } from "./themes";

function themeHeader(name: string): string {
  return `/**
 * @name ${name}
 * @version 1.0.0
 * @description A theme
 * @author Tester
 */
`;
}

/** Installs the real shared engine as the adapter finds it on the host. */
function installThemeEngine(): void {
  const current = window.__ION__ ?? {};
  Object.defineProperty(window, "__ION__", {
    configurable: true,
    value: {
      ...current,
      themeHost: {
        parseHeader: parseThemeHeader,
        syncDirectory: syncThemeDirectory,
        watchDirectory: watchThemesDir,
      },
    },
  });
}

interface FakeWatcher {
  /** Reports a change, as the shell does. */
  notify(path: string): void;
  unsubscribed(): boolean;
}

/** The fixture's bridge, plus the `watch` method hot reload rides on. */
function installWatchingShell(files: Record<string, string>): FakeWatcher {
  installShell(files);
  const shell = window.ionShell;
  if (!shell) throw new Error("installShell must publish a bridge");

  let listener: ((changed: readonly string[]) => void) | undefined;
  let unsubscribed = false;
  shell.files.watch = (_path, onChanged) => {
    listener = onChanged;
    return () => {
      unsubscribed = true;
      listener = undefined;
    };
  };
  return {
    notify: (path) => listener?.([path]),
    unsubscribed: () => unsubscribed,
  };
}

let store: FakeThemeStore;

beforeEach(() => {
  store = fakeThemeStore();
  installThemes(store);
  installThemeEngine();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("loadBdThemes", () => {
  it("registers every theme with parsed metadata and full CSS", async () => {
    const source = `${themeHeader("Radial")}body { color: red; }`;
    installShell({
      "Radial.theme.css": source,
      "Plain.css": "not a theme",
      "notes.txt": "not a theme",
    });

    const loaded = await loadBdThemes();

    expect(loaded).toEqual(["bd.Radial"]);
    expect(store.registered).toEqual([
      {
        id: "bd.Radial",
        name: "Radial",
        description: "A theme",
        authors: ["Tester"],
        version: "1.0.0",
        filename: "Radial.theme.css",
        css: source,
      },
    ]);
  });

  it("registers a header-less theme.css as plain CSS named after its file", async () => {
    installShell({ "Handwritten.theme.css": ":root { --x: 1; }" });

    const loaded = await loadBdThemes();

    expect(loaded).toEqual(["bd.Handwritten"]);
    expect(store.registered).toEqual([
      {
        id: "bd.Handwritten",
        name: "Handwritten",
        description: "No description provided",
        authors: [],
        version: undefined,
        filename: "Handwritten.theme.css",
        css: ":root { --x: 1; }",
      },
    ]);
  });

  it("keeps every @author line of a header", async () => {
    const source = `/**
 * @name Duo
 * @author First
 * @author Second
 */
body {}`;
    installShell({ "Duo.theme.css": source });

    expect(await loadBdThemes()).toEqual(["bd.Duo"]);
    expect(store.registered[0]?.authors).toEqual(["First", "Second"]);
  });

  it("skips duplicate downloads with a rename hint", async () => {
    installShell({ "Foo.theme (1).css": themeHeader("Foo") });

    const loaded = await loadBdThemes();

    expect(loaded).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("rename it to Foo.theme.css"),
    );
  });

  it("skips an unreadable file and says why", async () => {
    // Present in the listing, missing from the read bridge.
    installShell({ "Gone.theme.css": themeHeader("Gone") });
    Object.defineProperty(window, "ionShell", {
      configurable: true,
      value: {
        files: {
          readdir: () => Promise.resolve(["Gone.theme.css"]),
          readFile: () => Promise.reject(new Error("ENOENT: bd/themes/Gone.theme.css")),
        },
      },
    });

    expect(await loadBdThemes()).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("Gone.theme.css: skipped — unreadable"),
    );
  });

  it("skips a theme the store refuses and reports the collision", async () => {
    store.failRegisterNames.add("Radial");
    installShell({ "Radial.theme.css": themeHeader("Radial") });

    const loaded = await loadBdThemes();

    expect(loaded).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("Radial.theme.css: skipped — theme name already registered"),
    );
  });

  it("treats a missing themes directory as nothing to load", async () => {
    installShell(undefined);

    expect(await loadBdThemes()).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("bd/themes"),
    );
  });

  it("treats a missing shell bridge as nothing to load", async () => {
    Object.defineProperty(window, "ionShell", { configurable: true, value: undefined });

    expect(await loadBdThemes()).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      "no shell bridge: the bd/themes directory was not read",
    );
  });

  it("rejects when the core bundle is missing", async () => {
    delete window.__ION__;

    await expect(loadBdThemes()).rejects.toThrow("window.__ION__.themes is missing");
  });
});

describe("reloadBdTheme", () => {
  it("re-reads a changed file, swapping it into the store", async () => {
    const files: Record<string, string> = {
      "Radial.theme.css": `${themeHeader("Radial")}body { color: red; }`,
    };
    installShell(files);
    await loadBdThemes();

    files["Radial.theme.css"] = `${themeHeader("Radial")}body { color: blue; }`;
    await expect(reloadBdTheme("Radial")).resolves.toBe(true);

    // The old entry is replaced; enablement keys live outside the record.
    expect(store.unregistered).toEqual(["bd.Radial"]);
    expect(store.registered).toHaveLength(1);
    expect(store.registered[0]?.css).toContain("blue");
  });

  it("drops the theme to plain CSS when its header is deleted", async () => {
    const files: Record<string, string> = {
      "Radial.theme.css": `${themeHeader("Radial")}body { color: red; }`,
    };
    installShell(files);
    await loadBdThemes();

    files["Radial.theme.css"] = "body { color: red; }";
    await expect(reloadBdTheme("bd.Radial")).resolves.toBe(true);

    // Same id (the file name still describes it), no header left to read.
    expect(store.registered[0]?.authors).toEqual([]);
    expect(store.registered[0]?.version).toBeUndefined();
    expect(store.registered[0]?.css).toContain("red");
  });

  it("keeps the running theme when the file is unreadable", async () => {
    const files: Record<string, string> = {
      "Radial.theme.css": `${themeHeader("Radial")}body { color: red; }`,
    };
    installShell(files);
    await loadBdThemes();

    Object.defineProperty(window, "ionShell", {
      configurable: true,
      value: {
        files: {
          readdir: () => Promise.resolve(["Radial.theme.css"]),
          readFile: () => Promise.reject(new Error("ENOENT")),
        },
      },
    });

    await expect(reloadBdTheme("bd.Radial")).resolves.toBe(false);
    expect(store.unregistered).toEqual([]);
    expect(store.registered).toHaveLength(1);
    expect(store.registered[0]?.css).toContain("red");
  });

  it("answers false for an unknown theme", async () => {
    installShell({});

    await expect(reloadBdTheme("Ghost")).resolves.toBe(false);
  });

  it("answers false without a shell bridge", async () => {
    store.api.register({
      id: "bd.Radial",
      name: "Radial",
      description: "A theme",
      authors: ["Tester"],
      filename: "Radial.theme.css",
      css: "body {}",
    });
    Object.defineProperty(window, "ionShell", { configurable: true, value: undefined });

    await expect(reloadBdTheme("bd.Radial")).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("reload failed — no shell bridge"),
    );
  });
});

describe("watchBdThemes", () => {
  it("re-reads the directory when the shell reports a change", async () => {
    vi.useFakeTimers();
    const files: Record<string, string> = {
      "Radial.theme.css": `${themeHeader("Radial")}body { color: red; }`,
    };
    const watcher = installWatchingShell(files);
    await loadBdThemes();
    watchBdThemes();

    files["Late.theme.css"] = "body { color: blue; }";
    watcher.notify("bd/themes");
    await vi.advanceTimersByTimeAsync(200);

    expect(store.registered.map((theme) => theme.filename)).toEqual([
      "Radial.theme.css",
      "Late.theme.css",
    ]);
    // The subscription is a no-op to release: an adapter bundle has no
    // teardown point, and unwatching would only leak the callback.
    expect(watcher.unsubscribed()).toBe(false);
  });

  it("leaves a theme running when its file stops parsing mid-save", async () => {
    vi.useFakeTimers();
    const files: Record<string, string> = {
      "Radial.theme.css": `${themeHeader("Radial")}body { color: red; }`,
    };
    const watcher = installWatchingShell(files);
    await loadBdThemes();
    watchBdThemes();

    files["Radial.theme.css"] = "/**";
    watcher.notify("bd/themes/Radial.theme.css");
    await vi.advanceTimersByTimeAsync(200);

    // A half-written file is still plain CSS, so the theme survives under
    // its file name; only an unreadable file would keep the old content.
    expect(store.registered).toHaveLength(1);
    expect(store.registered[0]?.name).toBe("Radial");
  });

  it("does nothing without a shell bridge", () => {
    Object.defineProperty(window, "ionShell", { configurable: true, value: undefined });

    const unwatch = watchBdThemes();
    // Releasing is a no-op here: there was never a subscription to drop.
    unwatch();
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      "no shell bridge: bd/themes is not watched for changes",
    );
  });
});
