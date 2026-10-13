/**
 * The Shelter plugin manager: staged files in, live plugins out.
 *
 * One record per installed plugin, keyed by the host id `shelter.<folder>`.
 * The record is a discriminated union because a plugin can be installed and
 * still be unusable — a directory whose `plugin.js` is missing, a manifest
 * that is not valid JSON. Those stay registered under their folder name and
 * fail at start with the reason, so they show up on the scoreboard with an
 * explanation rather than looking like plugins that were never installed.
 *
 * Two rules shape the lifecycle:
 *
 * - A plugin is evaluated *after* `window.shelter` is complete, so a module
 *   that destructures several API members at once never reads `undefined`
 *   out of a half-built object.
 * - Every plugin callback runs under that plugin's log scope, and every
 *   plugin transition is bounded by a deadline. Upstream does not await
 *   `onLoad`, so a plugin that returns a promise which never settles keeps
 *   its status at "starting" forever; here that is a failure with a reason,
 *   because a plugin that silently never finishes must not read as a pass.
 */

import type { DomStorage, IonPlugin, IonPluginsApi, ShellHost } from "@ion/core";
import type { InstalledEntry, LoadedEntry, PluginsBridge, PluginsSnapshot } from "./api/plugins";
import type { PluginApi } from "./api/pluginapi";
import type { ShelterApiSurface } from "./api";
import type { ShelterPluginExport } from "./evaluate";
import type { ShelterManifest } from "./manifest";
import type { PluginScope } from "./logger";

import { createPluginApi } from "./api/pluginapi";
import { adapterLog, errorMessage, runInPluginScope, shelterLog } from "./logger";
import { evaluateShelterPlugin } from "./evaluate";
import { parseManifest } from "./manifest";
import {
  readStagedPlugins,
  shelterPluginIdFor,
  SHELTER_PLUGIN_ROOT,
  type StagedPlugin,
} from "./staging";

/**
 * How long one lifecycle hook may run before the plugin is failed with that
 * reason. Generous for real work, short enough that a plugin hanging inside
 * a never-resolving store lookup becomes a reported failure instead of a
 * plugin that reads as "starting" through the whole run.
 */
const LIFECYCLE_DEADLINE_MS = 30_000;

/** Resolves once the shared `window.shelter` build has finished. */
type ApiProvider = () => Promise<ShelterApiSurface>;

/** Everything the manager reaches for; wired by the adapter entry. */
export interface ShelterManagerDeps {
  readonly host: IonPluginsApi;
  readonly storage: DomStorage;
  readonly shell: ShellHost | undefined;
  readonly api: ApiProvider;
}

interface BaseRecord {
  readonly hostId: string;
  readonly folder: string;
}

interface ReadyRecord extends BaseRecord {
  readonly ok: true;
  readonly manifest: ShelterManifest;
  readonly js: string;
  readonly scope: PluginScope;
  /** Set once the source has been evaluated *and* `onLoad` returned. */
  evaluated?: ShelterPluginExport | undefined;
  pluginApi?: PluginApi | undefined;
}

interface UnusableRecord extends BaseRecord {
  readonly ok: false;
  readonly reason: string;
}

type ShelterRecord = ReadyRecord | UnusableRecord;

/**
 * A staged entry once its manifest has been read, awaiting a name.
 *
 * `displayName` starts as the manifest name and is provisional until
 * {@link resolveDisplayNames} has seen every entry: two plugins may well
 * publish under one.
 */
type Prepared =
  | {
      readonly ok: true;
      readonly staged: Extract<StagedPlugin, { ok: true }>;
      readonly manifest: ShelterManifest;
      displayName: string;
    }
  | {
      readonly ok: false;
      /** Any staged entry: a failure can be the file *or* its manifest. */
      readonly staged: StagedPlugin;
      readonly reason: string;
      displayName: string;
    };

/** The name an entry would have if no other entry contested it. */
function displayNameBase(item: Prepared): string {
  // A usable entry is named by its manifest; one whose manifest could not be
  // read falls back to its folder, which is unique by construction.
  return item.ok ? item.manifest.name : item.staged.folder;
}

/**
 * Gives every entry a display name no other entry is using.
 *
 * Two plugins published under one name are two different plugins, and the
 * host refuses a duplicate outright — which used to throw inside `register`,
 * reject `initialize()`, and log `Shelter plugin loading aborted`, dropping
 * every plugin staged behind the collision. A collision now costs the pair a
 * suffix rather than the run.
 *
 * The decision is made against the whole set instead of against read order,
 * so the same directory yields the same names on every run: everyone in a
 * shared group is suffixed with its folder, and folders are unique by
 * construction.
 */
function resolveDisplayNames(prepared: readonly Prepared[]): void {
  const seen = new Set<string>();
  const contested = new Set<string>();
  for (const item of prepared) {
    const base = displayNameBase(item);
    if (seen.has(base)) contested.add(base);
    seen.add(base);
  }

  for (const item of prepared) {
    const base = displayNameBase(item);
    if (contested.has(base)) item.displayName = `${base} (${item.staged.folder})`;
  }
}

/**
 * Races a promise against the lifecycle deadline, rejecting with a message
 * naming what timed out and how long it had.
 */
async function withinDeadline<T>(what: string, promise: PromiseLike<T>): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    handle = setTimeout(() => {
      resolve(undefined);
    }, LIFECYCLE_DEADLINE_MS);
  });

  try {
    const outcome = await Promise.race([promise.then((value) => ({ value })), deadline]);
    if (outcome === undefined) {
      throw new Error(
        `${what} did not finish within ${String(LIFECYCLE_DEADLINE_MS / 1000)} seconds`,
      );
    }
    return outcome.value;
  } finally {
    if (handle !== undefined) clearTimeout(handle);
  }
}

/**
 * Runs one lifecycle hook under the owning plugin's log scope, under the same
 * deadline. Upstream never awaits `onLoad`, so a plugin whose hook never
 * settles sits at `starting` forever; here that is a named failure instead.
 * A hook's returned promise is awaited too, so an async `onLoad` that rejects
 * after its first `await` still fails the start rather than floating.
 */
async function runScoped(
  scope: PluginScope,
  what: string,
  hook: () => void | PromiseLike<void>,
): Promise<void> {
  let pending: PromiseLike<void> | undefined;
  runInPluginScope(scope, () => {
    const result = hook();
    if (result !== undefined) pending = result;
  });
  await withinDeadline(what, pending ?? Promise.resolve());
}

/**
 * Resolves once the document has a body, which `observeDom` needs. A body
 * that already exists is enough even while `readyState` still reads
 * "loading" — a test environment reports exactly that.
 */
function whenBodyExists(): Promise<void> {
  if (document.readyState !== "loading" || document.querySelector("body") !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

function stringField(manifest: ShelterManifest, key: string): string | undefined {
  const value = manifest[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export class ShelterPluginManager {
  readonly #records = new Map<string, ShelterRecord>();
  readonly #deps: ShelterManagerDeps;

  constructor(deps: ShelterManagerDeps) {
    this.#deps = deps;
  }

  /** The surface `shelterApi` needs to reach the Ion host. */
  get bridge(): PluginsBridge {
    return {
      snapshot: () => this.snapshot(),
      subscribe: (listener) => this.#deps.host.subscribe(listener),
      setEnabled: (id, enabled) => this.#deps.host.setEnabled(shelterPluginIdFor(id), enabled),
    };
  }

  /** Discovers every staged plugin and registers it with the host. */
  async initialize(): Promise<void> {
    const prepared = (await readStagedPlugins(this.#deps.shell)).map((entry) =>
      this.#prepare(entry),
    );
    // Two passes, and the split is the point: a display name can only be
    // decided once every plugin that wants one is known, so the first pass
    // reads and the second registers under names that no longer collide.
    resolveDisplayNames(prepared);
    for (const item of prepared) this.#add(this.#toRecord(item));
    adapterLog(
      "info",
      `found ${String(this.#records.size)} staged plugin${this.#records.size === 1 ? "" : "s"}`,
    );
  }

  /** Installed and loaded plugins, as `shelter.plugins` reads them. */
  snapshot(): PluginsSnapshot {
    const installed: Record<string, InstalledEntry> = {};
    const loaded: Record<string, LoadedEntry> = {};

    for (const record of this.#records.values()) {
      if (!record.ok) continue;
      installed[record.folder] = {
        manifest: record.manifest,
        src: `${SHELTER_PLUGIN_ROOT}/${record.folder}`,
      };
      const evaluated = record.evaluated;
      if (evaluated !== undefined) {
        loaded[record.folder] = { manifest: record.manifest, settings: evaluated.settings };
      }
    }

    return { installed, loaded };
  }

  /**
   * Reads one staged entry into a record without registering it.
   *
   * Every failure of a single plugin is carried here as a reason rather than
   * thrown: an unreadable directory or a manifest that is not valid JSON
   * becomes a plugin that fails at start with that reason, so it still shows
   * up on the scoreboard instead of disappearing from it.
   */
  #prepare(staged: StagedPlugin): Prepared {
    if (!staged.ok) {
      return { ok: false, staged, reason: staged.reason, displayName: staged.folder };
    }

    let manifest: ShelterManifest;
    try {
      manifest = parseManifest(
        staged.manifestJson,
        `${SHELTER_PLUGIN_ROOT}/${staged.folder}/plugin.json`,
      );
    } catch (error) {
      return {
        ok: false,
        staged,
        reason: `plugin.json could not be read — ${errorMessage(error)}`,
        displayName: staged.folder,
      };
    }

    return { ok: true, staged, manifest, displayName: manifest.name };
  }

  #toRecord(item: Prepared): ShelterRecord {
    if (!item.ok) {
      return {
        hostId: item.staged.hostId,
        folder: item.staged.folder,
        ok: false,
        reason: item.reason,
      };
    }

    return {
      hostId: item.staged.hostId,
      folder: item.staged.folder,
      ok: true,
      manifest: item.manifest,
      js: item.staged.js,
      // The resolved name, not the manifest's: they differ when two plugins
      // published under one, and this becomes the console label the harness
      // attributes messages by.
      scope: { id: item.staged.hostId, name: item.displayName },
    };
  }

  #add(record: ShelterRecord): void {
    this.#records.set(record.hostId, record);
    this.#deps.host.register(this.#toHostPlugin(record));
  }

  #toHostPlugin(record: ShelterRecord): IonPlugin {
    if (!record.ok) {
      const { folder, reason, hostId } = record;
      return {
        id: hostId,
        name: folder,
        description: reason,
        defaultEnabled: true,
        startAt: "webpack-ready",
        start: () => {
          throw new Error(reason);
        },
      };
    }

    const ready = record;
    const author = stringField(ready.manifest, "author");
    return {
      id: ready.hostId,
      // The scope name, not the raw manifest name: they differ when two
      // plugins published under one name, and the console label has to be
      // the one the host registered under or the harness cannot attribute
      // the second plugin's messages to it.
      name: ready.scope.name,
      description: stringField(ready.manifest, "description") ?? "",
      authors: author === undefined ? undefined : [{ name: author }],
      version: stringField(ready.manifest, "version"),
      defaultEnabled: true,
      // Shelter's own loader runs once Discord's client is up: its plugins
      // subscribe to Flux and patch live objects, neither of which exists
      // before the webpack runtime has been captured. The body wait inside
      // `#start` covers the other half of that — `observeDom` observes it.
      startAt: "webpack-ready",
      start: () => this.#start(ready),
      stop: () => this.#stop(ready),
    };
  }

  async #start(record: ShelterRecord): Promise<void> {
    if (!record.ok) throw new Error(record.reason);
    const ready = record;

    await whenBodyExists();

    const api = await withinDeadline(
      `the window.shelter API build for ${ready.manifest.name}`,
      this.#deps.api(),
    );

    const pluginApi = createPluginApi({
      id: ready.folder,
      manifest: ready.manifest,
      storage: this.#deps.storage,
      deps: { flux: api.flux, http: api.http, settings: api.settings },
      ui: api.ui,
      scope: ready.scope,
      getSettings: () => ready.evaluated?.settings,
    });

    // The per-plugin edition: upstream spreads the window API and adds
    // `plugin`, so a plugin's `shelter.plugin` is its own store and scope
    // while every other member is shared.
    //
    // Recorded before evaluation: a file that registers a patch and *then*
    // throws has to have that patch cleaned up by the same path that handles
    // a failing `onLoad`, and until now it would have leaked it.
    ready.pluginApi = pluginApi;

    let evaluated: ShelterPluginExport | undefined;
    try {
      // Evaluation runs under the plugin's scope — a `log` call in a module
      // body belongs to the plugin that made it, not to the adapter.
      evaluated = runInPluginScope(ready.scope, () => {
        const evaluation = evaluateShelterPlugin(ready.js, ready.folder, {
          ...api,
          plugin: pluginApi,
        });
        if (evaluation.note !== null) shelterLog(evaluation.note, "warn");
        return evaluation.plugin;
      });

      const onLoad = evaluated.onLoad;
      if (onLoad !== undefined) {
        await runScoped(ready.scope, `onLoad for ${ready.manifest.name}`, onLoad);
      }
    } catch (error) {
      await this.#teardown(ready, evaluated);
      throw error;
    }

    ready.evaluated = evaluated;
  }

  async #stop(record: ShelterRecord): Promise<void> {
    if (!record.ok) return;
    const evaluated = record.evaluated;
    if (evaluated === undefined) return;
    await this.#teardown(record, evaluated);
  }

  /**
   * Upstream's `stopPlugin`: unload, then drop every scoped registration.
   *
   * `evaluated` may be undefined when the file itself threw part way through
   * evaluation — after it had already registered something. The registrations
   * still have to go, which is the whole reason this is not simply
   * `onUnload?.()`.
   */
  async #teardown(record: ReadyRecord, evaluated: ShelterPluginExport | undefined): Promise<void> {
    const onUnload = evaluated?.onUnload;
    try {
      if (onUnload !== undefined) {
        await runScoped(record.scope, `onUnload for ${record.manifest.name}`, onUnload);
      }
    } finally {
      record.pluginApi?.scoped.disposeAllNow();
      record.evaluated = undefined;
      record.pluginApi = undefined;
    }
  }
}
