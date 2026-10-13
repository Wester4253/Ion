// @vitest-environment happy-dom
/**
 * Unit tests for the BD theme loader: header parsing into store fields,
 * per-file isolation, duplicate-download hints, and reload keeping the
 * current theme when a file stops parsing.
 */

// The loader's contract IS console output: the compat harness reads it
// back to attribute failures, so these tests spy on it.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeThemeStore,
  installShell,
  installThemes,
  type FakeThemeStore,
} from "../testing/fixtures";
import { loadBdThemes, reloadBdTheme } from "./themes";

function themeHeader(name: string): string {
  return `/**
 * @name ${name}
 * @version 1.0.0
 * @description A theme
 * @author Tester
 */
`;
}

let store: FakeThemeStore;

beforeEach(() => {
  store = fakeThemeStore();
  installThemes(store);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
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

  it("skips a file without a meta header and says why", async () => {
    installShell({ "NoMeta.theme.css": "body { color: red; }" });

    const loaded = await loadBdThemes();

    expect(loaded).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("NoMeta.theme.css: skipped"),
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

  it("keeps the running theme when the file stops parsing", async () => {
    const files: Record<string, string> = {
      "Radial.theme.css": `${themeHeader("Radial")}body { color: red; }`,
    };
    installShell(files);
    await loadBdThemes();

    files["Radial.theme.css"] = "body { color: red; }";
    await expect(reloadBdTheme("bd.Radial")).resolves.toBe(false);

    expect(store.unregistered).toEqual([]);
    expect(store.registered).toHaveLength(1);
    expect(store.registered[0]?.css).toContain("red");
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("Radial.theme.css: skipped — no meta comment"),
    );
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
