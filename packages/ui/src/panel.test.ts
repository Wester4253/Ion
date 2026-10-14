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
    catalog: {
      fetchAll: () => Promise.resolve([]),
      fetchSource: () => Promise.resolve([]),
      download: () => Promise.reject(new Error("not implemented in test")),
      stage: () => Promise.resolve({ ok: false, error: "not implemented in test" }),
    },
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
  it("styles from Discord's design tokens, with only Discord's own literal colors", () => {
    // The panel must ride the current visual-refresh tokens...
    expect(PANEL_CSS).toContain("var(--text-strong");
    expect(PANEL_CSS).toContain("var(--text-default");
    expect(PANEL_CSS).toContain("var(--brand-500");
    expect(PANEL_CSS).toContain("var(--background-surface-higher");
    // ...and must never reference tokens Discord removed in the refresh.
    for (const dead of [
      "--background-primary",
      "--background-secondary",
      "--background-tertiary",
      "--header-primary",
      "--header-secondary",
      "--interactive-normal",
      "--interactive-active",
      "--background-modifier-accent",
      "--text-normal",
    ]) {
      expect(PANEL_CSS).not.toContain(dead);
    }

    // Strip var(--token, fallback) calls, then every remaining color literal
    // must be one Discord itself hardcodes inline (switch off-track and hover
    // border, dropdown shadow, color-mix hover base).
    const stripped = PANEL_CSS.replace(/var\(\s*--[a-z0-9-]+[^)]*\)/g, "");
    const literals = stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? [];
    const allowed = new Set([
      "rgba(0, 0, 0, 0.12)",
      "rgba(151, 151, 159, 0.4)",
      "rgba(0, 0, 0, 0.16)",
      "rgb(0 0 0)",
    ]);
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) {
      expect(allowed.has(literal), `unexpected color literal: ${literal}`).toBe(true);
    }
    // The theme provides the font; a bare `font-family: Arial` rule would not.
    expect(PANEL_CSS).not.toContain("font-family: Arial");
  });

  it("renders into a shadow root with the stylesheet, and unmounts cleanly", () => {
    const { shadow, unmount } = renderPanel();
    const style = shadow.querySelector("style");
    expect(style?.textContent).toBe(PANEL_CSS);
    expect(shadow.querySelector(".ion-heading")?.textContent).toBe("Ion");
    unmount();
    expect(shadow.querySelector(".ion-heading")).toBeNull();
    expect(shadow.querySelector("style")).toBeNull();
  });

  it("lays out as flat Discord-style sections divided by rules", async () => {
    const { shadow, unmount } = renderPanel();
    await flush();
    const titles = [...shadow.querySelectorAll(".ion-section-title")].map((h) => h.textContent);
    expect(titles).toEqual(["Plugins", "Catalog", "App", "About"]);
    expect(shadow.querySelectorAll(".ion-divider")).toHaveLength(3);
    expect(shadow.querySelector(".ion-card")).toBeNull(); // no legacy cards
    unmount();
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

  it("anchors the menu at a fixed viewport position below the trigger", async () => {
    const { shadow, unmount } = renderPanel();
    await flush();
    const trigger = shadow.querySelector<HTMLButtonElement>('[aria-label="Display server"]');
    trigger?.click();
    await flush();

    // Fixed positioning (from the stylesheet) is what keeps the menu clear of
    // the scroller's clipping; left/top/minWidth are pinned at open time from
    // the trigger's viewport rect.
    expect(PANEL_CSS).toMatch(/\.ion-select-menu \{[^}]*position: fixed/);
    const menu = shadow.querySelector<HTMLElement>(".ion-select-menu");
    expect(menu?.style.left).toMatch(/px$/);
    expect(menu?.style.top).toMatch(/px$/);
    expect(menu?.style.minWidth).toMatch(/px$/);
    unmount();
  });

  it("closes on Escape and moves between options with the arrow keys", async () => {
    const { shadow, unmount } = renderPanel();
    await flush();
    const trigger = shadow.querySelector<HTMLButtonElement>('[aria-label="Display server"]');
    trigger?.click();
    await flush();

    const menu = shadow.querySelector<HTMLElement>(".ion-select-menu");
    if (!menu) throw new Error("menu should be open");
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flush();
    const options = [...menu.querySelectorAll<HTMLElement>(".ion-select-option")];
    const root = menu.getRootNode() as ShadowRoot;
    expect(root.activeElement).toBe(options[1]);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
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
