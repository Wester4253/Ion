/**
 * BetterDiscord's addon manager, mapped onto Ion's plugin host.
 *
 * Upstream `PluginManager` owns its own enablement store, MutationObserver,
 * and navigation events; here those responsibilities belong to the host:
 * `initialize()` evaluates every `bd/plugins/*.plugin.js` file and
 * registers one Ion plugin per addon, and the host calls back into the
 * lifecycle handles below. The pieces the host does not have stay in this
 * file, ported from upstream (Apache-2.0, see THIRD_PARTY.md): the shared
 * refcounted MutationObserver behind BD's deprecated `observer()`, the
 * navigation event behind BD's deprecated `onSwitch()`, and per-plugin
 * error isolation — a plugin that throws while loading, starting,
 * stopping, observing, or switching is reported under its own name and
 * never affects another plugin's lifecycle.
 *
 * Deliberate deviations from upstream, recorded in THIRD_PARTY.md:
 * - a display name the host already owns (e.g. one of Vencord's 32
 *   acceptance plugins) is SKIPPED with a one-line reason — upstream has a
 *   single flat namespace where the later addon simply wins,
 * - `require()` is an honest throwing shim (see evaluate.ts),
 * - BD plugins default to enabled, matching the host's default; upstream
 *   keeps a persisted enable map that defaults to off,
 * - the runAt points map onto the host's stages (`connection` →
 *   `webpack-ready`, `idle` → `dom-ready`), since BD's CONNECTION_OPEN
 *   and idle moments have no direct stage of their own.
 */

import type { IonPlugin, IonPluginsApi, ShellHost } from "@ion/core";

import { boundLoggerFor } from "../api/logger";
import {
  evaluatePluginModule,
  instantiatePlugin,
  type BdPluginExport,
  type BdPluginInstance,
} from "./evaluate";
import { readAddonMeta, type BdAddonMeta } from "./meta";
import { subscribeNavigation } from "./navigation";

const PLUGIN_DIR = "bd/plugins";
const PLUGIN_EXTENSION = ".plugin.js";
/** Upstream's browser-download duplicate (`Foo.plugin (1).js`). */
const DUPLICATE_DOWNLOAD = /\.plugin\s?\([0-9]+\)\.js/;

/** One loaded addon, registered with the host under {@link hostId}. */
export interface BdPluginRecord {
  readonly meta: BdAddonMeta;
  readonly instance: BdPluginInstance;
  /** The id this addon occupies: `bd.<name>`, whitespace replaced by `_`. */
  readonly hostId: string;
  /** Upstream: whether `start()` found an `observer` method (refcounted). */
  hasObserver: boolean;
}

/** The MutationObserver surface the manager needs; tests inject a fake. */
export interface ObserverHandle {
  observe(target: Node, options?: MutationObserverInit): void;
  disconnect(): void;
}

/** A batch of mutations, as the shared observer delivers them. */
export type MutationBatch = readonly MutationRecord[];

export interface BdPluginManagerDeps {
  readonly createMutationObserver?: (
    callback: (mutations: MutationBatch) => void,
  ) => ObserverHandle;
}

/**
 * The adapter's own logger scope: lines that are about loading, not about
 * one plugin. The harness keeps them visible as unattributed warnings —
 * never dropped, never blamed on the wrong plugin.
 */
export const adapterLogger = boundLoggerFor("compat-bd");

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostIdFor(name: string): string {
  return `bd.${name.replace(/\s+/g, "_")}`;
}

/**
 * Validates the runtime shape of what a (JavaScript) plugin file produced:
 * factories can return anything, so the loader checks the interface itself
 * instead of trusting the declared type.
 */
function isPluginInstance(value: unknown): value is BdPluginInstance {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { start?: unknown; stop?: unknown };
  return typeof candidate.start === "function" && typeof candidate.stop === "function";
}

export class BdPluginManager {
  readonly #records: BdPluginRecord[] = [];
  readonly #active = new Set<BdPluginRecord>();
  readonly #createObserver: (callback: (mutations: MutationBatch) => void) => ObserverHandle;
  #observer: ObserverHandle | undefined;
  #observerRefs = 0;
  #unsubscribeNavigation: (() => void) | undefined;
  #navigationRefs = 0;
  #initialized = false;

  constructor(deps: BdPluginManagerDeps = {}) {
    this.#createObserver =
      deps.createMutationObserver ??
      ((callback) =>
        new MutationObserver((records) => {
          callback(records);
        }));
  }

  /**
   * Evaluates and registers every plugin in `bd/plugins`. Individual files
   * fail in isolation — one bad plugin never blocks another — so the only
   * rejection path is a missing plugin host.
   */
  async initialize(): Promise<readonly BdPluginRecord[]> {
    if (this.#initialized) return this.#records;
    const host = window.__ION__?.plugins;
    if (!host) {
      throw new Error(
        "[ion] compat-bd requires the Ion core bundle (window.__ION__.plugins is missing)",
      );
    }
    this.#initialized = true;

    const shell = window.ionShell;
    if (!shell) {
      adapterLogger.warn("no shell bridge: the bd/plugins directory was not read");
      return this.#records;
    }

    let entries: readonly string[];
    try {
      // Sorted so load order is deterministic across platforms.
      entries = (await shell.files.readdir(PLUGIN_DIR)).sort();
    } catch (error) {
      // Expected on a fresh profile: the user has not installed plugins yet.
      adapterLogger.log(`no ${PLUGIN_DIR} directory (${errorMessage(error)})`);
      return this.#records;
    }

    for (const filename of entries) {
      if (DUPLICATE_DOWNLOAD.test(filename)) {
        adapterLogger.warn(
          `${filename}: skipped — duplicate download; rename it to ${filename.replace(DUPLICATE_DOWNLOAD, ".plugin.js")}`,
        );
        continue;
      }
      if (!filename.endsWith(PLUGIN_EXTENSION)) continue;
      const record = await this.#loadAddon(shell, filename);
      if (record && this.#register(host, record)) this.#records.push(record);
    }
    return this.#records;
  }

  /** Every addon successfully registered with the host. */
  list(): readonly BdPluginRecord[] {
    return this.#records;
  }

  /**
   * Resolves by host id, plugin name, or filename. Upstream matches id or
   * filename; BD's id *is* its name, so all three resolve here.
   */
  resolve(idOrName: string): BdPluginRecord | undefined {
    return this.#records.find(
      (record) =>
        record.hostId === idOrName ||
        record.meta.name === idOrName ||
        record.meta.filename === idOrName,
    );
  }

  /**
   * BD's addon list mounts `getSettingsPanel()` inside its own modal; Ion's
   * plugin panel renders toggles only, so there is nowhere to show one yet.
   * This returns what the plugin produced and says so — it never fabricates
   * a panel.
   */
  settingsPanel(idOrName: string): unknown {
    const record = this.resolve(idOrName);
    if (!record || typeof record.instance.getSettingsPanel !== "function") return undefined;
    try {
      const panel = record.instance.getSettingsPanel.call(record.instance);
      adapterLogger.warn(
        `${record.meta.name}: its settings panel cannot be shown — Ion's plugin panel renders toggles only`,
      );
      return panel;
    } catch (error) {
      adapterLogger.warn(`${record.meta.name}: getSettingsPanel() threw — ${errorMessage(error)}`);
      return undefined;
    }
  }

  async #loadAddon(shell: ShellHost, filename: string): Promise<BdPluginRecord | undefined> {
    const path = `${PLUGIN_DIR}/${filename}`;
    let source: string;
    try {
      source = await shell.files.readFile(path, "utf8");
    } catch (error) {
      adapterLogger.warn(`${filename}: unreadable — ${errorMessage(error)}`);
      return undefined;
    }

    const read = readAddonMeta(filename, source);
    if (!read.ok) {
      // Nothing to attribute to but the filename: there is no @name yet.
      adapterLogger.warn(`${filename}: skipped — ${read.reason}`);
      return undefined;
    }
    const { meta } = read;

    let exported: unknown;
    try {
      exported = evaluatePluginModule(source, meta.filename, PLUGIN_DIR);
    } catch (error) {
      this.#fail(meta, "failed to evaluate", error);
      return undefined;
    }
    if (typeof exported !== "function") {
      this.#fail(meta, "did not export a function");
      return undefined;
    }

    let instance: unknown;
    try {
      instance = instantiatePlugin(exported as BdPluginExport, meta);
    } catch (error) {
      this.#fail(meta, "constructor threw", error);
      return undefined;
    }
    if (!isPluginInstance(instance)) {
      this.#fail(meta, "missing start() or stop()");
      return undefined;
    }

    return { meta, instance, hostId: hostIdFor(meta.name), hasObserver: false };
  }

  /** Registers with the host; false (plus a one-line reason) on a clash. */
  #register(host: IonPluginsApi, record: BdPluginRecord): boolean {
    const clash = host
      .list()
      .find((entry) => entry.name === record.meta.name || entry.id === record.hostId);
    if (clash) {
      adapterLogger.warn(
        `${record.meta.filename}: skipped — the host already has "${clash.name}" (${clash.id})`,
      );
      return false;
    }
    try {
      host.register(this.#toHostPlugin(record));
    } catch (error) {
      adapterLogger.warn(`${record.meta.filename}: skipped — ${errorMessage(error)}`);
      return false;
    }
    return true;
  }

  #toHostPlugin(record: BdPluginRecord): IonPlugin {
    return {
      id: record.hostId,
      name: record.meta.name,
      description: record.meta.description,
      authors: [{ name: record.meta.author }],
      version: record.meta.version,
      startAt: record.meta.runAt === "idle" ? "dom-ready" : "webpack-ready",
      start: () => {
        this.#startAddon(record);
      },
      stop: () => {
        this.#stopAddon(record);
      },
    };
  }

  #fail(meta: BdAddonMeta, reason: string, error?: unknown): void {
    const suffix = error === undefined ? "" : ` — ${errorMessage(error)}`;
    // `%c[Name]%c …` expands to "[Name] …" in the captured console output,
    // which is how the harness attributes this failure to the plugin.
    boundLoggerFor(meta.name).error(`${meta.name} v${meta.version} ${reason}${suffix}`);
  }

  #startAddon(record: BdPluginRecord): void {
    // Upstream order: run start(), then attach the observer only if start
    // succeeded — a throwing start() leaves no observer behind.
    record.instance.start();
    record.hasObserver = typeof record.instance.observer === "function";
    if (record.hasObserver) this.#retainObserver();
    if (typeof record.instance.onSwitch === "function") this.#retainNavigation();
    this.#active.add(record);
  }

  #stopAddon(record: BdPluginRecord): void {
    // Upstream releases the observer BEFORE running stop().
    if (this.#active.delete(record)) {
      if (record.hasObserver) this.#releaseObserver();
      if (typeof record.instance.onSwitch === "function") this.#releaseNavigation();
    }
    record.instance.stop();
  }

  #retainObserver(): void {
    this.#observerRefs++;
    if (this.#observer) return;
    this.#observer = this.#createObserver((mutations) => {
      this.#dispatchMutations(mutations);
    });
    this.#observer.observe(document, { childList: true, subtree: true });
  }

  #releaseObserver(): void {
    this.#observerRefs--;
    if (this.#observerRefs > 0 || !this.#observer) return;
    this.#observer.disconnect();
    this.#observer = undefined;
  }

  #dispatchMutations(mutations: MutationBatch): void {
    for (const mutation of mutations) {
      // A plugin may disable others (or itself) mid-batch; Set iteration
      // visits every entry that is still active.
      for (const record of this.#active) {
        if (typeof record.instance.observer !== "function") continue;
        try {
          record.instance.observer(mutation);
        } catch (error) {
          boundLoggerFor(record.meta.name).stacktrace(
            `observer() threw in ${record.meta.name} v${record.meta.version}`,
            error instanceof Error ? error : new Error(errorMessage(error)),
          );
        }
      }
    }
  }

  #retainNavigation(): void {
    this.#navigationRefs++;
    if (this.#unsubscribeNavigation) return;
    this.#unsubscribeNavigation = subscribeNavigation(() => {
      this.#dispatchSwitch();
    });
  }

  #releaseNavigation(): void {
    this.#navigationRefs--;
    if (this.#navigationRefs > 0 || !this.#unsubscribeNavigation) return;
    this.#unsubscribeNavigation();
    this.#unsubscribeNavigation = undefined;
  }

  #dispatchSwitch(): void {
    for (const record of this.#active) {
      if (typeof record.instance.onSwitch !== "function") continue;
      try {
        record.instance.onSwitch();
      } catch (error) {
        boundLoggerFor(record.meta.name).stacktrace(
          `onSwitch() threw in ${record.meta.name} v${record.meta.version}`,
          error instanceof Error ? error : new Error(errorMessage(error)),
        );
      }
    }
  }
}

/**
 * The adapter's shared manager: the bundle entry loads files through it,
 * and `BdApi.Plugins` (the AddonAPI) operates on the same records.
 */
export const pluginManager = new BdPluginManager();
