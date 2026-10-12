import { afterEach, describe, expect, it, vi } from "vitest";

import { PatchRegistry } from "./patches";
import type { IonPlugin, IonPluginPatch, ShellFileApi } from "./platform/shell";
import { createPluginHost, type PluginHost } from "./plugins";
import { createSettingsStore, type SettingsStore } from "./settings";

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
      // Plugin tests only need in-memory settings.
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

interface Fixture {
  readonly host: PluginHost;
  readonly registry: PatchRegistry;
  readonly settings: SettingsStore;
}

async function fixture(initialSettings?: Record<string, unknown>): Promise<Fixture> {
  const settings = createSettingsStore(fakeFiles(initialSettings));
  await settings.load();
  const registry = new PatchRegistry();
  return { host: createPluginHost({ registry, settings }), registry, settings };
}

function plugin(id: string, extra: Partial<IonPlugin> = {}): IonPlugin {
  return { id, name: id, description: `${id} test plugin`, ...extra };
}

const TEST_PATCH: IonPluginPatch = {
  find: "some module",
  replacement: [{ match: "needle", replace: "hay" }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plugin host lifecycle", () => {
  it("starts enabled plugins at boot in registration order", async () => {
    const { host } = await fixture();
    const order: string[] = [];
    host.register(plugin("first", { start: () => void order.push("first") }));
    host.register(plugin("second", { start: () => void order.push("second") }));
    await host.boot();

    expect(order).toEqual(["first", "second"]);
    expect(host.status()).toEqual({ registered: 2, started: 2, failed: 0 });
  });

  it("boots idempotently", async () => {
    const { host } = await fixture();
    const start = vi.fn();
    host.register(plugin("once", { start }));
    await host.boot();
    await host.boot();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("honors the persisted disabled state", async () => {
    const { host } = await fixture({ "plugins.enabled.off": false });
    const start = vi.fn();
    host.register(plugin("on", { start }));
    host.register(plugin("off", { start }));
    await host.boot();

    expect(start).toHaveBeenCalledTimes(1);
    expect(host.list().map((info) => [info.id, info.enabled, info.state])).toEqual([
      ["on", true, "started"],
      ["off", false, "stopped"],
    ]);
  });

  it("respects defaultEnabled when nothing is persisted", async () => {
    const { host } = await fixture();
    const start = vi.fn();
    host.register(plugin("optout", { defaultEnabled: false, start }));
    await host.boot();
    expect(start).not.toHaveBeenCalled();
  });

  it("isolates a throwing start and keeps booting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { host } = await fixture();
    const survivor = vi.fn();
    host.register(
      plugin("boom", {
        start: () => {
          throw new Error("exploded");
        },
      }),
    );
    host.register(plugin("survivor", { start: survivor }));
    await host.boot();

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(host.status()).toEqual({ registered: 2, started: 1, failed: 1 });
    const [failed] = host.list().filter((info) => info.state === "failed");
    expect(failed?.error).toBe("exploded");
  });

  it("isolates a rejecting async start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { host } = await fixture();
    host.register(plugin("slow-bad", { start: () => Promise.reject(new Error("late")) }));
    await host.boot();
    expect(host.status().failed).toBe(1);
  });

  it("rejects duplicate ids and duplicate names", async () => {
    const { host } = await fixture();
    host.register(plugin("dup"));
    expect(() => {
      host.register(plugin("dup"));
    }).toThrow("already registered");
    expect(() => {
      host.register({ ...plugin("other"), name: "dup" });
    }).toThrow("already registered");
  });

  it("rejects malformed ids and names", async () => {
    const { host } = await fixture();
    expect(() => {
      host.register(plugin(""));
    }).toThrow(TypeError);
    expect(() => {
      host.register(plugin("has space"));
    }).toThrow(TypeError);
    expect(() => {
      host.register({ ...plugin("ok"), name: "   " });
    }).toThrow(TypeError);
  });

  it("starts a plugin registered after boot when enabled", async () => {
    const { host } = await fixture();
    await host.boot();
    const start = vi.fn();
    host.register(plugin("late", { start }));
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1);
    });
  });

  it("stops and restarts through setEnabled", async () => {
    const { host, registry } = await fixture();
    const start = vi.fn();
    const stop = vi.fn();
    host.register(plugin("toggle", { patches: [TEST_PATCH], start, stop }));
    await host.boot();
    expect(registry.size).toBe(1);

    await host.setEnabled("toggle", false);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
    expect(host.list()[0]?.state).toBe("stopped");

    await host.setEnabled("toggle", true);
    expect(start).toHaveBeenCalledTimes(2);
    expect(registry.size).toBe(1);
  });

  it("persists the enabled flag across setEnabled", async () => {
    const { host, settings } = await fixture();
    host.register(plugin("persist"));
    await host.boot();
    await host.setEnabled("persist", false);
    expect(settings.get("plugins.enabled.persist", true)).toBe(false);
  });

  it("throws for unknown plugin ids", async () => {
    const { host } = await fixture();
    await expect(host.setEnabled("ghost", false)).rejects.toThrow("unknown plugin");
  });

  it("turns a plugin off even when stop() throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { host, registry } = await fixture();
    host.register(
      plugin("grumpy", {
        patches: [TEST_PATCH],
        stop: () => {
          throw new Error("refuses");
        },
      }),
    );
    await host.boot();
    await host.setEnabled("grumpy", false);

    expect(registry.size).toBe(0);
    const [info] = host.list();
    expect(info?.state).toBe("stopped");
    expect(info?.error).toBe("refuses");
  });
});

describe("plugin host patches", () => {
  it("registers patches attributed to the plugin and removes them on disable", async () => {
    const { host, registry } = await fixture();
    host.register(plugin("patched", { patches: [TEST_PATCH] }));
    expect(registry.size).toBe(0);
    await host.boot();
    expect(registry.size).toBe(1);

    await host.setEnabled("patched", false);
    expect(registry.size).toBe(0);
    // The attribution used for removal is the plugin's display name.
    expect(registry.removeByPlugin("patched")).toBe(0);
  });

  it("removes patches of a failed plugin when it is disabled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { host, registry } = await fixture();
    host.register(
      plugin("halfway", {
        patches: [TEST_PATCH],
        start: () => {
          throw new Error("after patches");
        },
      }),
    );
    await host.boot();
    expect(registry.size).toBe(1);
    await host.setEnabled("halfway", false);
    expect(registry.size).toBe(0);
  });

  it("registers no patches for plugins that are disabled", async () => {
    const { host, registry } = await fixture({ "plugins.enabled.off": false });
    host.register(plugin("off", { patches: [TEST_PATCH] }));
    await host.boot();
    expect(registry.size).toBe(0);
  });

  it("retries a failed start without duplicating patches", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { host, registry } = await fixture();
    let flaky = true;
    const start = vi.fn(() => {
      if (flaky) throw new Error("flaky");
    });
    host.register(plugin("flaky", { patches: [TEST_PATCH], start }));
    await host.boot();
    expect(registry.size).toBe(1);
    expect(host.status().failed).toBe(1);

    flaky = false;
    await host.setEnabled("flaky", true);
    expect(start).toHaveBeenCalledTimes(2);
    expect(registry.size).toBe(1);
    expect(host.status()).toEqual({ registered: 1, started: 1, failed: 0 });
  });
});

describe("plugin context", () => {
  it("exposes namespaced, persisted settings and a scoped logger", async () => {
    const { host, settings } = await fixture();
    let observed: { color: string; events: string[]; hasLogger: boolean } | undefined;
    host.register(
      plugin("ctx", {
        start: (context) => {
          const events: string[] = [];
          context.settings.subscribe((key) => {
            events.push(key);
          });
          context.settings.set("color", "blue");
          observed = {
            color: context.settings.get("color", "none"),
            events,
            hasLogger: typeof context.log.info === "function",
          };
        },
      }),
    );
    await host.boot();

    expect(observed).toEqual({ color: "blue", events: ["color"], hasLogger: true });
    expect(settings.get("plugin.ctx.color", "")).toBe("blue");
    // The plugin's view is scoped: its key arrives without the prefix.
    const scoped = settings.namespace("plugin.ctx");
    expect(scoped.get("color", "")).toBe("blue");
  });

  it("reads persisted values through the context settings", async () => {
    const { host } = await fixture({ "plugin.tuned.level": 7 });
    let level = 0;
    host.register(
      plugin("tuned", {
        start: (context) => {
          level = context.settings.get("level", 0);
        },
      }),
    );
    await host.boot();
    expect(level).toBe(7);
  });
});

describe("plugin host dependencies", () => {
  it("enables and starts dependencies before the dependent plugin", async () => {
    const { host, settings } = await fixture();
    const order: string[] = [];
    host.register(plugin("api", { defaultEnabled: false, start: () => void order.push("api") }));
    host.register(plugin("user", { dependencies: ["api"], start: () => void order.push("user") }));
    await host.boot();

    expect(order).toEqual(["api", "user"]);
    // Upstream persists the dependency's enabled flag.
    expect(settings.get("plugins.enabled.api", false)).toBe(true);
  });

  it("resolves dependencies transitively", async () => {
    const { host } = await fixture();
    const order: string[] = [];
    host.register(plugin("deep", { defaultEnabled: false, start: () => void order.push("deep") }));
    host.register(plugin("mid", { defaultEnabled: false, dependencies: ["deep"] }));
    host.register(plugin("top", { dependencies: ["mid"], start: () => void order.push("top") }));
    await host.boot();

    expect(order).toEqual(["deep", "top"]);
  });

  it("warns and continues when a dependency is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { host } = await fixture();
    const start = vi.fn();
    host.register(plugin("needy", { dependencies: ["ghost"], start }));
    await host.boot();

    expect(start).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[ion] [plugins]",
      expect.stringContaining('unresolved dependency "ghost"'),
    );
  });

  it("survives a dependency cycle without hanging", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { host } = await fixture();
    host.register(plugin("a", { dependencies: ["b"] }));
    host.register(plugin("b", { dependencies: ["a"] }));
    await host.boot();
    expect(host.status().failed).toBe(0);
  });

  it("enables a dependency when the dependent is enabled at runtime", async () => {
    const { host, settings } = await fixture({ "plugins.enabled.user": false });
    host.register(plugin("api", { defaultEnabled: false }));
    host.register(plugin("user", { dependencies: ["api"] }));
    await host.boot();
    expect(settings.get("plugins.enabled.api", false)).toBe(false);

    await host.setEnabled("user", true);
    expect(settings.get("plugins.enabled.api", false)).toBe(true);
    await vi.waitFor(() => {
      expect(host.list().find((info) => info.id === "api")?.state).toBe("started");
    });
  });
});

describe("required plugins", () => {
  it("starts even when persisted disabled and cannot be toggled off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { host, settings } = await fixture({ "plugins.enabled.core": false });
    const start = vi.fn();
    host.register(plugin("core", { required: true, start }));
    await host.boot();

    expect(start).toHaveBeenCalledTimes(1);
    expect(host.list()[0]?.enabled).toBe(true);

    await host.setEnabled("core", false);
    expect(host.list()[0]?.state).toBe("started");
    // The persisted flag is untouched: required is force-enabled, not a toggle.
    expect(settings.get("plugins.enabled.core", true)).toBe(false);
    expect(warn).toHaveBeenCalledWith("[ion] [plugins]", expect.stringContaining("required"));
  });
});

describe("plugin host reporting", () => {
  it("formats authors and exposes identity fields in list()", async () => {
    const { host } = await fixture();
    host.register({
      ...plugin("fancy"),
      authors: [{ name: "Ada" }, { name: "Grace", id: "grace" }],
      version: "1.2.3",
    });
    await host.boot();

    expect(host.list()).toEqual([
      {
        id: "fancy",
        name: "fancy",
        description: "fancy test plugin",
        authors: ["Ada", "Grace (grace)"],
        version: "1.2.3",
        enabled: true,
        state: "started",
        error: undefined,
      },
    ]);
  });

  it("notifies subscribers on registration, boot, and toggles", async () => {
    const { host } = await fixture();
    const listener = vi.fn();
    const unsubscribe = host.subscribe(listener);
    host.register(plugin("watched"));
    expect(listener).toHaveBeenCalledTimes(1);

    await host.boot();
    expect(listener).toHaveBeenCalledTimes(2);

    await host.setEnabled("watched", false);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    await host.setEnabled("watched", true);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
