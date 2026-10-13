/**
 * BetterDiscord's addon manager, mapped onto Ion's plugin host.
 *
 * Upstream `PluginManager` owns its own enablement store, MutationObserver,
 * and navigation events; here those responsibilities belong to the host:
 * `initialize()` reads every `bd/plugins/*.plugin.js` file, parses its meta,
 * and registers one Ion plugin per addon, and the host calls back into the
 * lifecycle handles below. The pieces the host does not have stay in this
 * file, ported from upstream (Apache-2.0, see THIRD_PARTY.md): the shared
 * refcounted MutationObserver behind BD's deprecated `observer()`, the
 * navigation event behind BD's deprecated `onSwitch()`, and per-plugin
 * error isolation — a plugin that throws while evaluating, starting,
 * stopping, observing, or switching is reported under its own name and
 * never affects another plugin's lifecycle. A start that throws propagates
 * to the host, which records `state: "failed"` with the reason; swallowing
 * it here would let the host report a start that never happened.
 *
 * Modules are evaluated lazily, at the plugin's stage rather than at
 * `initialize()`. Upstream evaluates at load, but upstream injects after
 * Discord has loaded, so a plugin's top-level `BdApi.React` read already
 * has a value. Here `initialize()` runs before Discord's first script, so
 * an eager evaluation would hand every plugin `undefined` and pin it there
 * in its own variable. Evaluating at the stage matches the moment upstream
 * reaches: metadata parses at initialize, the module and its instance
 * exist from the start stage onward. See THIRD_PARTY.md.
 *
 * Deliberate deviations from upstream, recorded in THIRD_PARTY.md:
 * - a display name the host already owns (e.g. one of Vencord's 32
 *   acceptance plugins) is SKIPPED with a one-line reason — upstream has a
 *   single flat namespace where the later addon simply wins,
 * - `require()` satisfies `events` page-side and otherwise throws honestly
 *   with the module id (see evaluate.ts),
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
  /** The source this addon parsed from, re-read at its stage to evaluate. */
  readonly source: string;
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

/** Formats any thrown value for the one-line warnings this adapter logs. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The identity an addon occupies: `bd.<name>` with whitespace replaced,
 * shared by plugins (the host's namespace) and themes (the store's).
 */
export function bdAddonIdFor(name: string): string {
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
  /** Instances built at their stage, keyed by the addon's host id. */
  readonly #instances = new Map<string, BdPluginInstance>();
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
   * Reads and registers every plugin in `bd/plugins`, parsing each file's
   * metadata; modules evaluate later, at their stage (see the class
   * header). Individual files fail in isolation — one bad plugin never
   * blocks another — so the only rejection path is a missing plugin host.
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
    if (!record) return undefined;
    // A panel can only exist once the plugin has started: evaluation and
    // construction happen at the stage, so before it there is no instance
    // to ask. This says so instead of reporting a plugin that has none.
    const instance = this.#instances.get(record.hostId);
    if (!instance) {
      adapterLogger.warn(`${record.meta.name}: no settings panel yet — the plugin has not started`);
      return undefined;
    }
    if (typeof instance.getSettingsPanel !== "function") return undefined;
    try {
      const panel = instance.getSettingsPanel.call(instance);
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

    // Metadata only. The module itself evaluates at the start stage, which
    // is the moment upstream reaches (see the class header).
    return { meta: read.meta, source, hostId: bdAddonIdFor(read.meta.name), hasObserver: false };
  }

  /**
   * Evaluates the module and builds the instance. Called once, at the
   * addon's stage.
   *
   * A failure THROWS rather than being logged here: core's `startPlugin`
   * catches it and records `state: "failed"` with this message as the
   * plugin's `error`, which is the field the compat harness reads to score
   * `start failed: …`. Logging and returning would leave the host reporting
   * `state: "started"` with no error — a pass the adapter never earned.
   */
  #instantiate(record: BdPluginRecord): BdPluginInstance {
    const existing = this.#instances.get(record.hostId);
    if (existing) return existing;
    const { meta, source } = record;

    let exported: unknown;
    try {
      exported = evaluatePluginModule(source, meta.filename, PLUGIN_DIR);
    } catch (error) {
      throw new Error(`failed to evaluate — ${errorMessage(error)}`, { cause: error });
    }
    if (typeof exported !== "function") {
      throw new Error("did not export a function");
    }

    let instance: unknown;
    try {
      instance = instantiatePlugin(exported as BdPluginExport, meta);
    } catch (error) {
      throw new Error(`constructor threw — ${errorMessage(error)}`, { cause: error });
    }
    if (!isPluginInstance(instance)) {
      throw new Error("missing start() or stop()");
    }

    this.#instances.set(record.hostId, instance);
    return instance;
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

  #startAddon(record: BdPluginRecord): void {
    // Evaluation happens here rather than at initialize; see the class
    // header. It throws on failure so core records `state: "failed"` with
    // the reason — see `#instantiate`.
    const instance = this.#instantiate(record);
    // Upstream order: run start(), then attach the observer only if start
    // succeeded — a throwing start() leaves no observer behind.
    instance.start();
    record.hasObserver = typeof instance.observer === "function";
    if (record.hasObserver) this.#retainObserver();
    if (typeof instance.onSwitch === "function") this.#retainNavigation();
    this.#active.add(record);
  }

  #stopAddon(record: BdPluginRecord): void {
    const instance = this.#instances.get(record.hostId);
    // Stopped before it ever started (evaluation failed, or the stage never
    // arrived): there is nothing to release and nothing to run.
    if (!instance) return;
    // Upstream releases the observer BEFORE running stop().
    if (this.#active.delete(record)) {
      if (record.hasObserver) this.#releaseObserver();
      if (typeof instance.onSwitch === "function") this.#releaseNavigation();
    }
    instance.stop();
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
        // Only started addons are active, so an instance always exists here.
        const instance = this.#instances.get(record.hostId);
        if (!instance || typeof instance.observer !== "function") continue;
        try {
          instance.observer(mutation);
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
      const instance = this.#instances.get(record.hostId);
      if (!instance || typeof instance.onSwitch !== "function") continue;
      try {
        instance.onSwitch();
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
