// @vitest-environment happy-dom
/**
 * Unit tests for the BetterDiscord plugin loader: meta → evaluation →
 * instantiation → host registration, plus the lifecycle the host drives
 * back into it (start/stop, the shared observer, onSwitch) and the
 * isolation rules — a broken plugin is reported under its own name and
 * never blocks another.
 */

// The loader's contract IS console output: the compat harness reads it
// back to attribute failures to plugins, so these tests spy on it.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pluginsHost } from "../host";
import {
  CLASS_BODY,
  classBody,
  ctx,
  installHost,
  installShell,
  pluginSource,
  resetCounters,
  type Counters,
} from "../testing/fixtures";
import { BdPluginManager, type MutationBatch, type ObserverHandle } from "./pluginmanager";

interface FakeObserverState {
  readonly callback: (mutations: MutationBatch) => void;
  observed: MutationObserverInit | undefined;
  disconnected: boolean;
}

let counters: Counters;

function observerFactory(): {
  factory: (callback: (mutations: MutationBatch) => void) => ObserverHandle;
  observers: FakeObserverState[];
} {
  const observers: FakeObserverState[] = [];
  const factory = (callback: (mutations: MutationBatch) => void): ObserverHandle => {
    const state: FakeObserverState = { callback, observed: undefined, disconnected: false };
    observers.push(state);
    return {
      observe: (_target, options) => {
        state.observed = options;
      },
      disconnect: () => {
        state.disconnected = true;
      },
    };
  };
  return { factory, observers };
}

beforeEach(() => {
  counters = resetCounters();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BdPluginManager", () => {
  it("loads a class plugin: meta parsed, registered, lifecycle wired", async () => {
    installShell({ "TestPlugin.plugin.js": pluginSource("TestPlugin", CLASS_BODY) });
    const registered = installHost();

    const records = await new BdPluginManager().initialize();

    expect(records).toHaveLength(1);
    expect(records[0]?.meta).toEqual({
      name: "TestPlugin",
      version: "1.0.0",
      description: "Test fixture",
      author: "Tester",
      runAt: "connection",
      filename: "TestPlugin.plugin.js",
    });

    const plugin = registered[0];
    expect(plugin).toMatchObject({
      id: "bd.TestPlugin",
      name: "TestPlugin",
      description: "Test fixture",
      startAt: "webpack-ready",
    });
    expect(plugin?.authors).toEqual([{ name: "Tester" }]);
    expect(plugin?.version).toBe("1.0.0");

    await plugin?.start?.(ctx);
    expect(counters.started).toBe(1);
    await plugin?.stop?.(ctx);
    expect(counters.stopped).toBe(1);
  });

  it("calls prototype-less factories directly", async () => {
    installShell({
      "Factory.plugin.js": pluginSource(
        "FactoryPlugin",
        `module.exports = (meta) => ({
  name: meta.name,
  start() { globalThis.bdCounters.started++; },
  stop() { globalThis.bdCounters.stopped++; },
});`,
      ),
    });
    const registered = installHost();

    await new BdPluginManager().initialize();

    expect(registered[0]?.name).toBe("FactoryPlugin");
    await registered[0]?.start?.(ctx);
    expect(counters.started).toBe(1);
  });

  it("unwraps ESM default exports", async () => {
    installShell({
      "Esm.plugin.js": pluginSource(
        "EsmPlugin",
        `module.exports.default = class {
  start() { globalThis.bdCounters.started++; }
  stop() { globalThis.bdCounters.stopped++; }
};`,
      ),
    });
    const registered = installHost();

    await new BdPluginManager().initialize();

    expect(registered[0]?.name).toBe("EsmPlugin");
  });

  it("skips a file with no meta comment and says why", async () => {
    installShell({ "NoMeta.plugin.js": "module.exports = class {};" });
    const registered = installHost();

    const records = await new BdPluginManager().initialize();

    expect(records).toHaveLength(0);
    expect(registered).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("NoMeta.plugin.js: skipped"),
    );
  });

  it("isolates a plugin that throws during evaluation", async () => {
    installShell({
      "Broken.plugin.js": pluginSource("Broken", 'throw new Error("load boom");'),
      "Good.plugin.js": pluginSource("Good", CLASS_BODY),
    });
    const registered = installHost();
    const host = pluginsHost();

    const records = await new BdPluginManager().initialize();

    // Metadata parses for both: a module that cannot evaluate still
    // registers, and fails only when its stage arrives.
    expect(records.map((record) => record.meta.name)).toEqual(["Broken", "Good"]);
    expect(registered.map((plugin) => plugin.name)).toEqual(["Broken", "Good"]);

    await host.setEnabled("bd.Broken", true);
    await host.setEnabled("bd.Good", true);

    // The failure reaches the host as state + error, which is what the
    // compat harness scores as `start failed: …`. Logging it here instead
    // would leave the host reporting `started` with no error — a pass the
    // adapter never earned.
    const broken = host.list().find((info) => info.id === "bd.Broken");
    expect(broken?.state).toBe("failed");
    expect(broken?.error).toContain("failed to evaluate — load boom");
    expect(host.status().failed).toBe(1);

    // The broken plugin never started, and never touched the other one.
    expect(counters.started).toBe(1);
  });

  it("defers evaluation until the plugin's start stage", async () => {
    installShell({
      "Late.plugin.js": pluginSource("LatePlugin", CLASS_BODY),
    });
    const registered = installHost();

    await new BdPluginManager().initialize();

    // Nothing has evaluated or started yet: initialization is metadata only.
    expect(counters.started).toBe(0);

    await registered[0]?.start?.(ctx);
    expect(counters.started).toBe(1);
  });

  it("disambiguates a display name the host already owns", async () => {
    installShell({ "FakeNitro.plugin.js": pluginSource("FakeNitro", CLASS_BODY) });
    const registered = installHost({
      id: "FakeNitro",
      name: "FakeNitro",
      description: "Already registered by the Vencord adapter",
    });

    const records = await new BdPluginManager().initialize();

    expect(records).toHaveLength(1);
    expect(records[0]?.meta.name).toBe("FakeNitro");
    expect(registered).toHaveLength(2);
    expect(registered[1]).toMatchObject({ id: "bd.FakeNitro", name: "FakeNitro (BD)" });
    expect(console.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining('FakeNitro.plugin.js: display name "FakeNitro" clashes'),
    );
  });

  it("skips the second file sharing an @name", async () => {
    installShell({
      "TwinA.plugin.js": pluginSource("Twin", CLASS_BODY),
      "TwinB.plugin.js": pluginSource("Twin", CLASS_BODY),
    });
    const registered = installHost();

    const records = await new BdPluginManager().initialize();

    expect(records).toHaveLength(1);
    expect(registered).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("TwinB.plugin.js: skipped"),
    );
  });

  it("treats a missing plugins directory as nothing to load", async () => {
    installShell(undefined);
    const registered = installHost();

    const records = await new BdPluginManager().initialize();

    expect(records).toEqual([]);
    expect(registered).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("bd/plugins"),
    );
  });

  it("maps BD's runAt onto the host's start stages", async () => {
    installShell({
      "Idle.plugin.js": pluginSource("IdlePlugin", CLASS_BODY, "\n * @runAt idle"),
    });
    const registered = installHost();

    await new BdPluginManager().initialize();

    expect(registered[0]?.startAt).toBe("dom-ready");
  });

  it("shares one refcounted observer across observer plugins", async () => {
    installShell({
      "ObsA.plugin.js": pluginSource(
        "ObsA",
        classBody("observer() { globalThis.bdCounters.events.push(this.meta.name); }"),
      ),
      "ObsB.plugin.js": pluginSource(
        "ObsB",
        classBody("observer() { globalThis.bdCounters.events.push(this.meta.name); }"),
      ),
    });
    const registered = installHost();
    const { factory, observers } = observerFactory();
    const manager = new BdPluginManager({ createMutationObserver: factory });
    const records = await manager.initialize();
    expect(records).toHaveLength(2);

    await registered[0]?.start?.(ctx);
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observed).toEqual({ childList: true, subtree: true });
    expect(records[0]?.hasObserver).toBe(true);
    await registered[1]?.start?.(ctx);
    // A second observer plugin reuses the one shared observer.
    expect(observers).toHaveLength(1);

    const mutation = {} as MutationRecord;
    observers[0]?.callback([mutation]);
    expect(counters.events).toEqual(["ObsA", "ObsB"]);

    // Refcounted: the observer survives until the last plugin stops.
    await registered[0]?.stop?.(ctx);
    expect(observers[0]?.disconnected).toBe(false);
    await registered[1]?.stop?.(ctx);
    expect(observers[0]?.disconnected).toBe(true);
  });

  it("fires onSwitch through the History hook and stops when disabled", async () => {
    installShell({
      "Nav.plugin.js": pluginSource(
        "NavPlugin",
        classBody('onSwitch() { globalThis.bdCounters.events.push("switch"); }'),
      ),
    });
    const registered = installHost();
    await new BdPluginManager().initialize();
    expect(Object.hasOwn(history, "pushState")).toBe(false);

    await registered[0]?.start?.(ctx);
    expect(Object.hasOwn(history, "pushState")).toBe(true);
    history.pushState({}, "", "/channel/1");
    expect(counters.events).toEqual(["switch"]);

    await registered[0]?.stop?.(ctx);
    expect(Object.hasOwn(history, "pushState")).toBe(false);
    history.pushState({}, "", "/channel/2");
    expect(counters.events).toEqual(["switch"]);
  });

  it("isolates an observer that throws and attributes it to the plugin", async () => {
    installShell({
      "Calm.plugin.js": pluginSource(
        "Calm",
        classBody('observer() { globalThis.bdCounters.events.push("Calm"); }'),
      ),
      "Thrower.plugin.js": pluginSource(
        "Thrower",
        classBody('observer() { throw new Error("observer boom"); }'),
      ),
    });
    const registered = installHost();
    const { factory, observers } = observerFactory();
    await new BdPluginManager({ createMutationObserver: factory }).initialize();
    await registered[0]?.start?.(ctx);
    await registered[1]?.start?.(ctx);

    observers[0]?.callback([{} as MutationRecord]);

    // The throwing plugin is reported under its own name; the other still ran.
    expect(counters.events).toEqual(["Calm"]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("%c[Thrower]%c observer() threw in Thrower v1.0.0"),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ message: "observer boom" }),
    );
  });

  it("returns a plugin's settings panel and says it cannot be shown", async () => {
    installShell({
      "Panel.plugin.js": pluginSource(
        "PanelPlugin",
        'module.exports = class { start() {} stop() {} getSettingsPanel() { return "panel-value"; } };',
      ),
    });
    const registered = installHost();
    const manager = new BdPluginManager();
    await manager.initialize();

    // Before the stage there is no instance to ask, and it says so rather
    // than reporting a plugin that has none.
    expect(manager.settingsPanel("PanelPlugin")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("not started"),
    );

    await registered[0]?.start?.(ctx);

    expect(manager.settingsPanel("PanelPlugin")).toBe("panel-value");
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      expect.stringContaining("cannot be shown"),
    );
    expect(manager.settingsPanel("NoSuchPlugin")).toBeUndefined();
  });

  it("fails fast when the core bundle is missing", async () => {
    delete window.__ION__;

    await expect(new BdPluginManager().initialize()).rejects.toThrow(
      "window.__ION__.plugins is missing",
    );
  });

  it("treats a missing shell bridge as nothing to load", async () => {
    installHost();
    Object.defineProperty(window, "ionShell", { configurable: true, value: undefined });

    const records = await new BdPluginManager().initialize();

    expect(records).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "",
      "no shell bridge: the bd/plugins directory was not read",
    );
  });
});
