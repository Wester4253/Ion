// @vitest-environment happy-dom
/**
 * Unit tests for the Shelter plugin manager: what gets registered with the
 * Ion host (including directories that cannot be read, so they still show up
 * with a reason), when a plugin is marked loaded, and that a failing `onLoad`
 * tears the plugin back out instead of leaving it half-installed.
 */

import { describe, expect, it } from "vitest";
import type { DomStorage, IonPlugin, IonPluginsApi, ShellHost } from "@ion/core";

import type { ShelterApiSurface } from "./api";
import { SHELTER_PLUGIN_ROOT } from "./staging";
import { ShelterPluginManager } from "./manager";

interface TestHost {
  readonly api: IonPluginsApi;
  readonly registered: Map<string, IonPlugin>;
}

function fakeHost(): TestHost {
  const registered = new Map<string, IonPlugin>();
  const api = {
    register: (plugin: IonPlugin): void => {
      registered.set(plugin.id, plugin);
    },
    list: (): readonly unknown[] => [],
    setEnabled: (): Promise<void> => Promise.resolve(),
    status: (): unknown => ({}),
    subscribe: (): (() => void) => () => undefined,
  } as unknown as IonPluginsApi;
  return { api, registered };
}

function fakeShell(
  files: Record<string, string>,
  directories: Record<string, string[]>,
): ShellHost {
  return {
    files: {
      readdir: (path: string): Promise<string[]> => {
        const entries = directories[path];
        return entries === undefined
          ? Promise.reject(new Error(`ENOENT: ${path}`))
          : Promise.resolve(entries);
      },
      readFile: (path: string): Promise<string> => {
        const content = files[path];
        return content === undefined
          ? Promise.reject(new Error(`ENOENT: ${path}`))
          : Promise.resolve(content);
      },
    },
  } as unknown as ShellHost;
}

function fakeStorage(): DomStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    backend: "localStorage",
    read: (key) => data.get(key) ?? null,
    write: (key, value) => {
      data.set(key, value);
    },
    remove: (key) => {
      data.delete(key);
    },
  };
}

/**
 * The window-level API surface, minus the parts `#start` does not touch.
 * `marker` is the sentinel a staged `onLoad` checks so the test proves the
 * plugin received the real API rather than an empty object.
 */
const fakeApi = {
  marker: "ok",
  flux: {},
  http: {},
  settings: {},
  ui: { openModal: () => undefined },
} as unknown as ShelterApiSurface;

function managerFor(
  files: Record<string, string>,
  directories: Record<string, string[]>,
  host: TestHost = fakeHost(),
): { manager: ShelterPluginManager; host: TestHost; storage: ReturnType<typeof fakeStorage> } {
  const storage = fakeStorage();
  const manager = new ShelterPluginManager({
    host: host.api,
    storage,
    shell: fakeShell(files, directories),
    api: () => Promise.resolve(fakeApi),
  });
  return { manager, host, storage };
}

const MANIFEST = JSON.stringify({
  name: "Antitrack",
  description: "Tightens the User-Agent.",
  author: "Somebody",
  version: "1.2.3",
});

describe("registration", () => {
  it("registers a staged plugin under its host id, carrying manifest fields", async () => {
    const { manager, host } = managerFor(
      {
        [`${SHELTER_PLUGIN_ROOT}/antitrack/plugin.json`]: MANIFEST,
        [`${SHELTER_PLUGIN_ROOT}/antitrack/plugin.js`]: "({})",
      },
      { [SHELTER_PLUGIN_ROOT]: ["antitrack"] },
    );

    await manager.initialize();

    const plugin = host.registered.get("shelter.antitrack");
    expect(plugin?.name).toBe("Antitrack");
    expect(plugin?.description).toBe("Tightens the User-Agent.");
    expect(plugin?.version).toBe("1.2.3");
    expect(plugin?.authors).toEqual([{ name: "Somebody" }]);
    expect(plugin?.startAt).toBe("webpack-ready");
  });

  it("registers an unreadable directory as a plugin that fails at start", async () => {
    const { manager, host } = managerFor({}, { [SHELTER_PLUGIN_ROOT]: ["broken"] });

    await manager.initialize();

    const plugin = host.registered.get("shelter.broken");
    expect(plugin?.name).toBe("broken");
    expect(plugin?.description).toContain("could not be read");
    expect(() => plugin?.start?.({} as never)).toThrow(/could not be read/);
  });

  it("registers a manifest that is not valid JSON as a failing plugin", async () => {
    const { manager, host } = managerFor(
      {
        [`${SHELTER_PLUGIN_ROOT}/badjson/plugin.json`]: "{",
        [`${SHELTER_PLUGIN_ROOT}/badjson/plugin.js`]: "({})",
      },
      { [SHELTER_PLUGIN_ROOT]: ["badjson"] },
    );

    await manager.initialize();

    const plugin = host.registered.get("shelter.badjson");
    expect(plugin?.name).toBe("badjson");
    expect(plugin?.description).toContain("plugin.json could not be read");
    expect(() => plugin?.start?.({} as never)).toThrow(/not valid JSON/);
  });

  it("registers nothing when no plugins are staged", async () => {
    const { manager, host } = managerFor({}, {});
    await manager.initialize();
    expect(host.registered.size).toBe(0);
  });
});

describe("start and snapshot", () => {
  const staged = {
    files: {
      [`${SHELTER_PLUGIN_ROOT}/antitrack/plugin.json`]: MANIFEST,
      [`${SHELTER_PLUGIN_ROOT}/antitrack/plugin.js`]:
        "({ onLoad() { if (shelter.marker !== 'ok') throw new Error('api missing'); } })",
    },
    directories: { [SHELTER_PLUGIN_ROOT]: ["antitrack"] },
  };

  it("evaluates the source and runs onLoad before reporting it loaded", async () => {
    const { manager, host } = managerFor(staged.files, staged.directories);
    await manager.initialize();

    expect(manager.snapshot().loaded).toEqual({});

    const start = host.registered.get("shelter.antitrack")?.start;
    expect(start).toBeDefined();
    await start?.({} as never);

    expect(Object.keys(manager.snapshot().loaded)).toEqual(["antitrack"]);
    expect(manager.snapshot().loaded["antitrack"]?.manifest.name).toBe("Antitrack");
  });

  it("keeps a plugin out of the loaded snapshot until onLoad succeeds", async () => {
    const failing = `${SHELTER_PLUGIN_ROOT}/antitrack/plugin.js`;
    const { manager, host } = managerFor(
      {
        [`${SHELTER_PLUGIN_ROOT}/antitrack/plugin.json`]: MANIFEST,
        [failing]: "({ onLoad() { throw new Error('load failed'); } })",
      },
      { [SHELTER_PLUGIN_ROOT]: ["antitrack"] },
    );
    await manager.initialize();

    await expect(host.registered.get("shelter.antitrack")?.start?.({} as never)).rejects.toThrow(
      "load failed",
    );

    expect(manager.snapshot().loaded).toEqual({});
    expect(manager.snapshot().installed["antitrack"]?.manifest.name).toBe("Antitrack");
  });

  it("maps a folder name back onto the host id when toggling", async () => {
    const toggles: [string, boolean][] = [];
    const host = fakeHost();
    (
      host.api as unknown as { setEnabled: (id: string, enabled: boolean) => Promise<void> }
    ).setEnabled = async (id, enabled) => {
      toggles.push([id, enabled]);
      return Promise.resolve();
    };

    const { manager } = managerFor(
      {
        [`${SHELTER_PLUGIN_ROOT}/antitrack/plugin.json`]: MANIFEST,
        [`${SHELTER_PLUGIN_ROOT}/antitrack/plugin.js`]: "({})",
      },
      { [SHELTER_PLUGIN_ROOT]: ["antitrack"] },
      host,
    );
    await manager.initialize();

    await manager.bridge.setEnabled("antitrack", false);
    expect(toggles).toEqual([["shelter.antitrack", false]]);
  });

  it("surfaces installed plugins through the bridge snapshot", async () => {
    const { manager } = managerFor(staged.files, staged.directories);
    await manager.initialize();

    const snapshot = manager.bridge.snapshot();
    expect(Object.keys(snapshot.installed)).toEqual(["antitrack"]);
    expect(snapshot.installed["antitrack"]?.src).toBe(`${SHELTER_PLUGIN_ROOT}/antitrack`);
    expect(snapshot.loaded).toEqual({});
  });
});
