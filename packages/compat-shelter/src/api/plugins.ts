/**
 * `shelter.plugins` — the plugin list and lifecycle surface.
 *
 * Upstream's `src/plugins.tsx` owns installation, storage, and evaluation:
 * a plugin's files live in IndexedDB, the list is editable from a plugin
 * browser, and `startPlugin` both fetches and evaluates the source. Ion owns
 * those parts instead — the file system a shell scopes is where a plugin is
 * installed, and the Ion host holds its lifecycle — so this surface is the
 * part of upstream's API that maps onto it, plus honest failures for the
 * part that does not.
 *
 * `installedPlugins` and `loadedPlugins` are Solid accessors upstream's
 * plugins read as signals; here they are live views of the Ion host, so a
 * toggle made from Ion's own settings shows up in them.
 *
 * Anything that would install, edit, or delete plugin files throws by name:
 * those operations belong to Ion's catalog and plugin browser, and a
 * half-implemented version of them inside a plugin API would be exactly the
 * kind of silent gap this adapter refuses to ship.
 */

import { createSignal } from "solid-js";

import type { ShelterManifest } from "../manifest";
import type { UiSurface } from "./ui";
import { openSettingsModalAndWait } from "./settingsmodal";

/** One installed plugin, as upstream's `StoredPlugin` describes it. */
export interface InstalledEntry {
  readonly manifest: ShelterManifest;
  /** Profile-relative directory the plugin was read from. */
  readonly src: string;
}

/** One evaluated plugin, as upstream's `EvaledPlugin` describes it. */
export interface LoadedEntry {
  readonly manifest: ShelterManifest;
  /** The plugin's `settings` component, when it exports one. */
  readonly settings?: ((props: Record<string, unknown>) => unknown) | undefined;
}

export interface PluginsSnapshot {
  readonly installed: Record<string, InstalledEntry>;
  readonly loaded: Record<string, LoadedEntry>;
}

/** What the plugin manager hands the API layer to reach the Ion host. */
export interface PluginsBridge {
  snapshot(): PluginsSnapshot;
  subscribe(listener: () => void): () => void;
  setEnabled(id: string, enabled: boolean): Promise<void>;
}

export interface PluginsSurfaceOptions extends PluginsBridge {
  ui: UiSurface;
}

function unavailable(name: string): never {
  throw new Error(
    `shelter.plugins.${name} is not supported: Ion installs, updates, and removes ` +
      `Shelter plugins through its own plugin browser and catalog`,
  );
}

/** Builds the `shelter.plugins` surface around the Ion host. */
export function createPluginsSurface(options: PluginsSurfaceOptions): PluginsSurface {
  const [installed, setInstalled] = createSignal(options.snapshot().installed);
  const [loaded, setLoaded] = createSignal(options.snapshot().loaded);

  options.subscribe(() => {
    const current = options.snapshot();
    setInstalled(() => current.installed);
    setLoaded(() => current.loaded);
  });

  return {
    installedPlugins: installed,
    loadedPlugins: loaded,

    async startPlugin(id: string): Promise<void> {
      await options.setEnabled(id, true);
    },

    async stopPlugin(id: string): Promise<void> {
      await options.setEnabled(id, false);
    },

    getSettings(id: string): ((props: Record<string, unknown>) => unknown) | undefined {
      return loaded()[id]?.settings;
    },

    showSettingsFor(id: string): Promise<void> {
      const entry = loaded()[id];
      if (entry === undefined) throw new Error(`cannot show plugins for non-loaded plugin ${id}`);
      if (entry.settings === undefined) {
        throw new Error(`cannot show plugins for ${id}, which has no settings`);
      }

      const component = entry.settings;
      // Upstream renders a header, the plugin's component, and no footer —
      // the dialog's own dismiss closes it — and resolves when the modal
      // unmounts; `openSettingsModalAndWait` builds exactly that.
      return openSettingsModalAndWait(options.ui.openModal, entry.manifest.name, component);
    },

    editPlugin: () => unavailable("editPlugin"),
    addLocalPlugin: () => unavailable("addLocalPlugin"),
    addRemotePlugin: () => unavailable("addRemotePlugin"),
    removePlugin: () => unavailable("removePlugin"),
    fetchUpdate: () => unavailable("fetchUpdate"),
    updatePlugin: () => unavailable("updatePlugin"),
  };
}

/** What `shelter.plugins` exposes. */
export interface PluginsSurface {
  installedPlugins(): Record<string, InstalledEntry>;
  loadedPlugins(): Record<string, LoadedEntry>;
  startPlugin(id: string): Promise<void>;
  stopPlugin(id: string): Promise<void>;
  getSettings(id: string): ((props: Record<string, unknown>) => unknown) | undefined;
  showSettingsFor(id: string): Promise<void>;
  editPlugin(...args: unknown[]): never;
  addLocalPlugin(...args: unknown[]): never;
  addRemotePlugin(...args: unknown[]): never;
  removePlugin(...args: unknown[]): never;
  fetchUpdate(...args: unknown[]): never;
  updatePlugin(...args: unknown[]): never;
}
