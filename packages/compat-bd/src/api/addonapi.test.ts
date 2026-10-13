// @vitest-environment happy-dom
// Unit tests for `BdApi.Plugins` and `BdApi.Themes`: upstream's AddonAPI
// contract (folder/isEnabled/enable/disable/toggle/reload/get/getAll)
// over the loader fakes. The plugin side injects a fresh manager because
// the bundle's manager is a module singleton that outlives a test; the
// theme side exercises the exact `BdApi.Themes` singleton users get.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonPlugin } from "@ion/core";

import {
  CLASS_BODY,
  ctx,
  fakeThemeStore,
  installHost,
  installShell,
  installThemes,
  pluginSource,
  resetCounters,
  type Counters,
  type FakeThemeStore,
} from "../testing/fixtures";
import { BdPluginManager } from "../manager/pluginmanager";
import { loadBdThemes } from "../manager/themes";
import { PluginsApi } from "./addonapi";
import { BdApi } from "./index";

function themeHeader(name: string): string {
  return `/**
 * @name ${name}
 * @version 1.0.0
 * @description A theme
 * @author Tester
 */
`;
}

let counters: Counters;
let store: FakeThemeStore;

beforeEach(() => {
  counters = resetCounters();
  store = fakeThemeStore();
  installThemes(store);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface PluginsFixture {
  readonly api: PluginsApi;
  readonly registered: IonPlugin[];
}

/** Loads one BD plugin into a freshly installed host, with its own API. */
async function pluginsFixture(): Promise<PluginsFixture> {
  installShell({ "TestPlugin.plugin.js": pluginSource("TestPlugin", CLASS_BODY) });
  const registered = installHost();
  const manager = new BdPluginManager();
  await manager.initialize();
  return { api: new PluginsApi(manager), registered };
}

describe("BdApi.Plugins", () => {
  it("exposes the BetterDiscord plugin folder", () => {
    expect(BdApi.Plugins.folder).toBe("bd/plugins");
    // The instance getter hands out the same shared instance.
    expect(new BdApi("someplugin").Plugins).toBe(BdApi.Plugins);
  });

  it("reports enablement and drives the host", async () => {
    const { api } = await pluginsFixture();
    expect(api.isEnabled("TestPlugin")).toBe(true);

    expect(api.disable("TestPlugin")).toBe(true);
    expect(api.isEnabled("TestPlugin")).toBe(false);
    expect(counters.stopped).toBe(1);

    expect(api.toggle("TestPlugin")).toBe(true);
    expect(api.isEnabled("TestPlugin")).toBe(true);
    expect(counters.started).toBe(1);
  });

  it("resolves by name and by filename", async () => {
    const { api } = await pluginsFixture();

    expect(api.isEnabled("TestPlugin")).toBe(true);
    expect(api.isEnabled("TestPlugin.plugin.js")).toBe(true);
    expect(api.get("TestPlugin.plugin.js")?.name).toBe("TestPlugin");
  });

  it("returns entries with upstream ids and slugs", async () => {
    const { api } = await pluginsFixture();

    expect(api.get("TestPlugin")).toEqual({
      name: "TestPlugin",
      version: "1.0.0",
      description: "Test fixture",
      author: "Tester",
      runAt: "connection",
      filename: "TestPlugin.plugin.js",
      id: "TestPlugin",
      slug: "TestPlugin",
      enabled: true,
    });
    expect(api.getAll()).toHaveLength(1);
  });

  it("answers false/undefined for unknown plugins", async () => {
    installShell({});
    installHost();
    const api = new PluginsApi(new BdPluginManager());

    expect(api.isEnabled("Ghost")).toBe(false);
    expect(api.enable("Ghost")).toBe(false);
    expect(api.disable("Ghost")).toBe(false);
    expect(api.toggle("Ghost")).toBe(false);
    expect(api.get("Ghost")).toBeUndefined();
    expect(api.getAll()).toEqual([]);
    await expect(api.reload("Ghost")).resolves.toBe(false);
  });

  it("restarts a running plugin through the host", async () => {
    const { api, registered } = await pluginsFixture();
    await registered[0]?.start?.(ctx);
    expect(counters.started).toBe(1);

    await expect(api.reload("TestPlugin")).resolves.toBe(true);

    expect(counters.stopped).toBe(1);
    expect(counters.started).toBe(2);
  });
});

describe("BdApi.Themes", () => {
  it("exposes the BetterDiscord theme folder", () => {
    expect(BdApi.Themes.folder).toBe("bd/themes");
    expect(new BdApi("someplugin").Themes).toBe(BdApi.Themes);
  });

  it("toggles the store synchronously", () => {
    store.api.register({
      id: "bd.Radial",
      name: "Radial",
      description: "A theme",
      authors: ["Tester"],
      version: "1.0.0",
      filename: "Radial.theme.css",
      css: "body { color: red; }",
    });

    expect(BdApi.Themes.isEnabled("Radial")).toBe(true);
    expect(BdApi.Themes.disable("Radial")).toBe(true);
    expect(BdApi.Themes.isEnabled("Radial")).toBe(false);
    expect(BdApi.Themes.toggle("Radial")).toBe(true);
    expect(BdApi.Themes.isEnabled("Radial")).toBe(true);
    expect(BdApi.Themes.enable("Radial")).toBe(true);
  });

  it("returns entries with upstream ids", () => {
    store.api.register({
      id: "bd.Radial",
      name: "Radial",
      description: "A theme",
      authors: ["Tester"],
      version: "1.0.0",
      filename: "Radial.theme.css",
      css: "body { color: red; }",
    });

    expect(BdApi.Themes.get("Radial")).toEqual({
      id: "Radial",
      slug: "Radial",
      name: "Radial",
      version: "1.0.0",
      description: "A theme",
      author: "Tester",
      filename: "Radial.theme.css",
      css: "body { color: red; }",
      enabled: true,
    });
    expect(BdApi.Themes.getAll()).toHaveLength(1);
  });

  it("answers false/undefined for unknown themes", () => {
    expect(BdApi.Themes.isEnabled("Ghost")).toBe(false);
    expect(BdApi.Themes.enable("Ghost")).toBe(false);
    expect(BdApi.Themes.disable("Ghost")).toBe(false);
    expect(BdApi.Themes.toggle("Ghost")).toBe(false);
    expect(BdApi.Themes.get("Ghost")).toBeUndefined();
    expect(BdApi.Themes.getAll()).toEqual([]);
  });

  it("re-reads a changed file through the loader", async () => {
    const files: Record<string, string> = {
      "Radial.theme.css": `${themeHeader("Radial")}body { color: red; }`,
    };
    installShell(files);
    expect(await loadBdThemes()).toEqual(["bd.Radial"]);

    files["Radial.theme.css"] = `${themeHeader("Radial")}body { color: blue; }`;
    await expect(BdApi.Themes.reload("Radial")).resolves.toBe(true);

    expect(store.unregistered).toEqual(["bd.Radial"]);
    expect(BdApi.Themes.get("Radial")?.css).toContain("blue");
  });
});
