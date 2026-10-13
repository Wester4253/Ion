/**
 * `BdApi.Plugins` and `BdApi.Themes` — upstream's AddonAPI surface backed
 * by Ion's plugin host and theme store.
 *
 * The method set is upstream's exact contract (`folder`, `isEnabled`,
 * `enable`, `disable`, `toggle`, `reload`, `get`, `getAll`); what differs
 * is the engine behind it. Deliberate deviations, recorded in
 * THIRD_PARTY.md:
 * - `enable`/`disable`/`toggle` answer synchronously with `true` when the
 *   command was accepted for a known addon — Ion's plugin lifecycle runs
 *   through the host's async stages, so a failure surfaces afterwards,
 *   attributed to the plugin in the console (upstream returned the
 *   synchronous `start()` result),
 * - `reload` is async: `Promise<boolean>` resolves on the actual outcome.
 *   Themes re-read their file from disk (keeping the old theme running on
 *   a parse failure); plugins restart through the host, because the host
 *   cannot replace an already-registered plugin's module,
 * - `get`/`getAll` return a plain entry object rather than the loader's
 *   internal records; `id` mirrors upstream (the name), while Ion's
 *   internal ids are `bd.<name>` — both resolve everywhere.
 */

import type { IonTheme } from "@ion/core";

import { pluginsHost, themesStore } from "../host";
import type { BdAddonMeta } from "../manager/meta";
import { type BdPluginManager, type BdPluginRecord, pluginManager } from "../manager/pluginmanager";
import { reloadBdTheme } from "../manager/themes";

/** One plugin as `get`/`getAll` hand it out — upstream's Addon shape. */
export interface BdAddonEntry extends BdAddonMeta {
  /** Upstream ids addons by their name; see the deviations note above. */
  readonly id: string;
  readonly slug: string;
  readonly enabled: boolean;
}

/** One theme as `get`/`getAll` hand it out — upstream's Theme shape. */
export interface BdThemeEntry {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly version?: string | undefined;
  readonly description: string;
  readonly author: string;
  readonly filename: string;
  readonly css: string;
  readonly enabled: boolean;
}

/** Upstream: `slug = filename minus the extension, spaces become dashes`. */
function slugOf(filename: string, extension: string): string {
  return filename.replace(extension, "").replace(/ /g, "-");
}

function pluginEntry(record: BdPluginRecord, hostEnabled: boolean): BdAddonEntry {
  return {
    ...record.meta,
    id: record.meta.name,
    slug: slugOf(record.meta.filename, ".plugin.js"),
    enabled: hostEnabled,
  };
}

function pluginEnabled(record: BdPluginRecord): boolean {
  const info = pluginsHost()
    .list()
    .find((entry) => entry.id === record.hostId);
  return info?.enabled ?? false;
}

function themeEntry(theme: IonTheme, enabled: boolean): BdThemeEntry {
  return {
    id: theme.name,
    slug: slugOf(theme.filename, ".theme.css"),
    name: theme.name,
    version: theme.version,
    description: theme.description,
    author: theme.authors?.[0] ?? "Unknown Author",
    filename: theme.filename,
    css: theme.css,
    enabled,
  };
}

/** Upstream's `AddonAPI` for Ion's plugin host. */
export class PluginsApi {
  readonly #manager: BdPluginManager;

  /**
   * The bundle wires the shared manager; tests inject their own, because
   * the module singleton outlives a single test file's fixtures.
   */
  constructor(manager: BdPluginManager = pluginManager) {
    this.#manager = manager;
  }

  /** The BetterDiscord plugin folder, as upstream exposes it. */
  readonly folder = "bd/plugins";

  isEnabled(idOrFile: string): boolean {
    const record = this.#manager.resolve(idOrFile);
    if (!record) return false;
    return pluginEnabled(record);
  }

  enable(idOrFile: string): boolean {
    const record = this.#manager.resolve(idOrFile);
    if (!record) return false;
    void pluginsHost().setEnabled(record.hostId, true);
    return true;
  }

  disable(idOrFile: string): boolean {
    const record = this.#manager.resolve(idOrFile);
    if (!record) return false;
    void pluginsHost().setEnabled(record.hostId, false);
    return true;
  }

  toggle(idOrFile: string): boolean {
    return this.isEnabled(idOrFile) ? this.disable(idOrFile) : this.enable(idOrFile);
  }

  /**
   * Restarts a running plugin's lifecycle (and its patches) through the
   * host; a stopped plugin has nothing to restart and is left as-is.
   * Resolves true when the restart completed, false when the plugin
   * failed to come back or is unknown.
   */
  async reload(idOrFile: string): Promise<boolean> {
    const record = this.#manager.resolve(idOrFile);
    if (!record) return false;
    const host = pluginsHost();
    if (pluginEnabled(record)) {
      await host.setEnabled(record.hostId, false);
      await host.setEnabled(record.hostId, true);
    }
    const after = host.list().find((entry) => entry.id === record.hostId);
    return after !== undefined && after.state !== "failed";
  }

  get(idOrFile: string): BdAddonEntry | undefined {
    const record = this.#manager.resolve(idOrFile);
    if (!record) return undefined;
    return pluginEntry(record, pluginEnabled(record));
  }

  getAll(): BdAddonEntry[] {
    return this.#manager.list().map((record) => pluginEntry(record, pluginEnabled(record)));
  }
}

/** Upstream's `AddonAPI` for Ion's theme store. */
export class ThemesApi {
  /** The BetterDiscord theme folder, as upstream exposes it. */
  readonly folder = "bd/themes";

  isEnabled(idOrFile: string): boolean {
    return themesStore().isEnabled(idOrFile);
  }

  enable(idOrFile: string): boolean {
    return themesStore().setEnabled(idOrFile, true);
  }

  disable(idOrFile: string): boolean {
    return themesStore().setEnabled(idOrFile, false);
  }

  toggle(idOrFile: string): boolean {
    const store = themesStore();
    return store.setEnabled(idOrFile, !store.isEnabled(idOrFile));
  }

  /**
   * Re-reads the theme's file from disk, preserving its enablement;
   * a file that no longer parses keeps the current theme running and
   * resolves false. (Async because the file bridge is async — see the
   * deviations note at the top of this file.)
   */
  reload(idOrFile: string): Promise<boolean> {
    return reloadBdTheme(idOrFile);
  }

  get(idOrFile: string): BdThemeEntry | undefined {
    const store = themesStore();
    const theme = store.get(idOrFile);
    if (!theme) return undefined;
    return themeEntry(theme, store.isEnabled(theme.id));
  }

  getAll(): BdThemeEntry[] {
    const store = themesStore();
    return store.list().flatMap((info) => {
      const theme = store.get(info.id);
      return theme ? [themeEntry(theme, info.enabled)] : [];
    });
  }
}
