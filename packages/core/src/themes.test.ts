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
import { createThemeStore, type ThemeStore } from "./themes";

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
