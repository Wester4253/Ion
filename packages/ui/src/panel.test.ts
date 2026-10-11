// @vitest-environment happy-dom
import { describe, expect, it, vi, type Mock } from "vitest";
import type { IonPluginInfo, IonPluginsApi, ShellSettingsApi } from "@ion/core";
import { mountPanel, type PanelPorts } from "./panel";
import { PANEL_CSS } from "./styles";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const flush = async (): Promise<void> => {
  await tick();
  await tick();
};

const TEST_PLUGIN: IonPluginInfo = {
  id: "test.plugin",
  name: "Test Plugin",
  description: "Does testing",
  authors: ["Tester"],
  version: "1.0.0",
  enabled: true,
  state: "started",
  error: undefined,
};

function fakePlugins(
  initial: readonly IonPluginInfo[],
  failIds: readonly string[] = [],
): { api: IonPluginsApi; setEnabled: Mock } {
  let list = [...initial];
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const setEnabled = vi.fn((id: string, enabled: boolean): Promise<void> => {
    if (failIds.includes(id)) return Promise.reject(new Error("toggle refused"));
    list = list.map((plugin) => (plugin.id === id ? { ...plugin, enabled } : plugin));
    notify();
    return Promise.resolve();
  });
  const api: IonPluginsApi = {
    register: () => undefined,
    list: () => list,
    setEnabled,
    status: () => ({ registered: list.length, started: 0, failed: 0 }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { api, setEnabled };
}

function fakeSettings(
  initial: Record<string, unknown>,
  refuse = false,
): { api: ShellSettingsApi; set: Mock; getAll: Mock } {
  let stored = { ...initial };
  const getAll = vi.fn((): Promise<Record<string, unknown>> => Promise.resolve({ ...stored }));
  const set = vi.fn((key: string, value: unknown): Promise<boolean> => {
    if (refuse) return Promise.resolve(false);
    stored = { ...stored, [key]: value };
    return Promise.resolve(true);
  });
  return { api: { getAll, set }, set, getAll };
}

interface Harness {
  readonly shadow: ShadowRoot;
  readonly ports: PanelPorts;
  readonly unmount: () => void;
}

function renderPanel(overrides: Partial<PanelPorts> = {}): Harness {
  const plugins = overrides.plugins ?? fakePlugins([TEST_PLUGIN]).api;
  const settings = overrides.shellSettings ?? fakeSettings({ closeToTray: true }).api;
  const ports: PanelPorts = {
    plugins,
    shellSettings: settings,
    version: "0.0.0-test",
    shellVersion: "0.0.0",
    webpackStatus: () => ({
      hooked: true,
      ready: true,
      factories: 42,
      cache: 7,
      byProps: true,
      store: true,
    }),
    openExternal: () => Promise.resolve(),
    ...overrides,
  };
  const host = document.createElement("ion-settings-panel");
  document.body.innerHTML = "";
  document.body.append(host);
  const unmount = mountPanel(host, ports);
  if (!host.shadowRoot) throw new Error("mountPanel must create a shadow root");
  return { shadow: host.shadowRoot, ports, unmount };
}

function pluginSwitch(shadow: ShadowRoot, name: string): HTMLElement | null {
  return shadow.querySelector(`[role="switch"][aria-label="${name}"]`);
}

describe("mountPanel", () => {
  it("styles from Discord variables only", () => {
    expect(PANEL_CSS).toContain("var(--background-primary");
    expect(PANEL_CSS).toContain("var(--header-primary");
    // Every hex literal must be a var() fallback, never a bare color.
    const hexes = PANEL_CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const fallbacks = PANEL_CSS.match(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9a-fA-F]{3,8}/g) ?? [];
    expect(hexes.length).toBe(fallbacks.length);
    expect(hexes.length).toBeGreaterThan(0);
    expect(PANEL_CSS).not.toMatch(/[^-(]\brgba?\(/);
    expect(PANEL_CSS).not.toMatch(/hsla?\(/);
    expect(PANEL_CSS).not.toContain("font-family: Arial"); // font must come from the theme
  });

  it("renders into a shadow root with the stylesheet, and unmounts cleanly", () => {
    const { shadow, unmount } = renderPanel();
    const style = shadow.querySelector("style");
    expect(style?.textContent).toBe(PANEL_CSS);
    expect(shadow.querySelector(".ion-title")?.textContent).toBe("Ion");
    unmount();
    expect(shadow.querySelector(".ion-title")).toBeNull();
    expect(shadow.querySelector("style")).toBeNull();
  });
});

describe("plugins card", () => {
  it("lists registered plugins with their state", async () => {
    const { shadow, unmount } = renderPanel();
    await flush();
    const label = shadow.querySelector(".ion-row-label");
    expect(label?.textContent).toBe("Test Plugin");
    expect(shadow.textContent).toContain("Does testing");
    expect(shadow.textContent).toContain("started");
    expect(pluginSwitch(shadow, "Test Plugin")?.getAttribute("aria-checked")).toBe("true");
    unmount();
  });

  it("toggles a plugin and reflects the new state", async () => {
    const plugins = fakePlugins([TEST_PLUGIN]);
    const { shadow, unmount } = renderPanel({ plugins: plugins.api });
    await flush();

    pluginSwitch(shadow, "Test Plugin")?.click();
    await flush();

    expect(plugins.setEnabled).toHaveBeenCalledWith("test.plugin", false);
    expect(pluginSwitch(shadow, "Test Plugin")?.getAttribute("aria-checked")).toBe("false");
    expect(plugins.api.list()[0]?.enabled).toBe(false);
    unmount();
  });

  it("surfaces a failed toggle instead of swallowing it", async () => {
    const plugins = fakePlugins([TEST_PLUGIN], ["test.plugin"]);
    const { shadow, unmount } = renderPanel({ plugins: plugins.api });
    await flush();

    pluginSwitch(shadow, "Test Plugin")?.click();
    await flush();

    expect(shadow.querySelector(".ion-row-error")?.textContent).toContain("toggle refused");
    // The switch reverts to the actual state.
    expect(pluginSwitch(shadow, "Test Plugin")?.getAttribute("aria-checked")).toBe("true");
    unmount();
  });
});

describe("app settings card", () => {
  it("loads stored values and saves toggles", async () => {
    const settings = fakeSettings({ closeToTray: true, trayEnabled: false });
    const { shadow, unmount } = renderPanel({ shellSettings: settings.api });
    await flush();

    const toggle = shadow.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Close button minimizes to tray"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    toggle?.click();
    await flush();

    expect(settings.set).toHaveBeenCalledWith("closeToTray", false);
    expect(
      shadow
        .querySelector('[role="switch"][aria-label="Close button minimizes to tray"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false");
    unmount();
  });

  it("reverts the optimistic value when the shell refuses the write", async () => {
    const settings = fakeSettings({ closeToTray: true }, true);
    const { shadow, unmount } = renderPanel({ shellSettings: settings.api });
    await flush();

    const before = shadow.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Close button minimizes to tray"]',
    );
    expect(before?.getAttribute("aria-checked")).toBe("true");
    before?.click();
    await flush();

    expect(settings.set).toHaveBeenCalledWith("closeToTray", false);
    expect(
      shadow
        .querySelector('[role="switch"][aria-label="Close button minimizes to tray"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    unmount();
  });

  it("changes a select and persists the choice", async () => {
    const settings = fakeSettings({ ozonePlatform: "auto" });
    const { shadow, unmount } = renderPanel({ shellSettings: settings.api });
    await flush();

    const trigger = shadow.querySelector<HTMLButtonElement>('[aria-label="Display server"]');
    expect(trigger).not.toBeNull();
    trigger?.click();
    await flush();

    const options = [...shadow.querySelectorAll<HTMLElement>(".ion-select-option")];
    expect(options).toHaveLength(3);
    options.find((option) => option.textContent.includes("X11"))?.click();
    await flush();

    expect(settings.set).toHaveBeenCalledWith("ozonePlatform", "x11");
    expect(
      shadow.querySelector<HTMLButtonElement>('[aria-label="Display server"]')?.textContent,
    ).toContain("X11");
    unmount();
  });

  it("closes the select when clicking outside it", async () => {
    const { shadow, unmount } = renderPanel();
    await flush();
    const trigger = shadow.querySelector<HTMLButtonElement>('[aria-label="Display server"]');
    trigger?.click();
    await flush();
    expect(shadow.querySelector(".ion-select-menu")).not.toBeNull();

    document.body.click();
    await flush();
    expect(shadow.querySelector(".ion-select-menu")).toBeNull();
    unmount();
  });
});

describe("about card", () => {
  it("shows version and webpack status", async () => {
    const { shadow, unmount } = renderPanel();
    await flush();
    expect(shadow.textContent).toContain("Version 0.0.0-test");
    expect(shadow.textContent).toContain("42 factories");
    unmount();
  });

  it("reports a failed external link instead of swallowing it", async () => {
    const { shadow, unmount } = renderPanel({
      openExternal: () => Promise.reject(new Error("refused url")),
    });
    await flush();

    shadow.querySelector<HTMLButtonElement>(".ion-link")?.click();
    await flush();
    expect(shadow.querySelector(".ion-row-error")?.textContent).toContain("refused url");
    unmount();
  });
});
