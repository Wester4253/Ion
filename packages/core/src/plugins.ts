/**
 * The native plugin host.
 *
 * Plugins register their manifest (mirroring Vencord's plugin shape) and the
 * host owns everything else: patch registration/removal, the start/stop
 * lifecycle, persisted enablement, and error isolation — one plugin failing
 * can never take the host or another plugin down.
 *
 * Timing contract: registration happens synchronously with core evaluation
 * (built-in plugins during bundle evaluation, external plugins right after),
 * and `boot()` runs after `settings.load()` — still within the microtask
 * checkpoint before Discord's first script, because the desktop file bridge
 * is synchronous IPC behind a promise. Plugin patches therefore register
 * with the user's true enabled state before any Discord module evaluates.
 *
 * Toggling off calls `stop()` and removes the plugin's active patches.
 * Modules a patch already modified keep the change (source patches are
 * one-way once evaluated); reverting runtime effects is the plugin's
 * `stop()` responsibility, exactly as upstream.
 */

import { createLogger } from "./logging";
import type { PatchRegistry } from "./patches";
import type {
  IonPluginContext,
  IonPlugin,
  IonPluginInfo,
  IonPluginStatus,
  IonPluginsApi,
} from "./platform/shell";
import type { SettingsStore } from "./settings";

const ENABLED_KEY_PREFIX = "plugins.enabled.";

const logger = createLogger("plugins");

type PluginState = "stopped" | "starting" | "started" | "stopping" | "failed";

interface PluginRecord {
  readonly definition: IonPlugin;
  readonly context: IonPluginContext;
  state: PluginState;
  error: string | undefined;
}

export interface PluginHostOptions {
  /** The shared registry the webpack runtime applies patches from. */
  readonly registry: PatchRegistry;
  readonly settings: SettingsStore;
  /**
   * Readiness waiters for `startAt` stages. Missing waiters resolve
   * immediately, which is also what unit tests want.
   */
  readonly stages?: {
    "webpack-ready"?: () => Promise<void>;
    "dom-ready"?: () => Promise<void>;
  };
}

export interface PluginHost extends IonPluginsApi {
  /** Start every enabled plugin. Called once, after settings load. */
  boot(): Promise<void>;
}

function assertDisplayName(value: string): void {
  if (value.trim().length === 0) {
    throw new TypeError("plugin name must be a non-empty string");
  }
}

function assertId(value: string): void {
  if (value.length === 0 || /\s/.test(value)) {
    throw new TypeError(`plugin id must be a non-empty token: ${JSON.stringify(value)}`);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPluginHost(options: PluginHostOptions): PluginHost {
  const { registry, settings } = options;
  const records = new Map<string, PluginRecord>();
  const recordsByName = new Map<string, PluginRecord>();
  const listeners = new Set<() => void>();
  let booted = false;

  const isEnabled = (definition: IonPlugin): boolean => {
    // `required` overrides persisted state: core runtime plugins are
    // force-enabled exactly like upstream, and cannot be toggled off.
    if (definition.required === true) return true;
    const external = definition.enabledState?.read();
    if (external !== undefined) return external;
    return settings.get(`${ENABLED_KEY_PREFIX}${definition.id}`, definition.defaultEnabled ?? true);
  };

  /** Persist enablement through the plugin's own store when it has one. */
  const writeEnabled = (definition: IonPlugin, enabled: boolean): void => {
    if (definition.enabledState) definition.enabledState.write(enabled);
    else settings.set(`${ENABLED_KEY_PREFIX}${definition.id}`, enabled);
  };

  const stageWaiter = (stage: NonNullable<IonPlugin["startAt"]>): Promise<void> => {
    if (stage === "init") return Promise.resolve();
    return options.stages?.[stage]?.() ?? Promise.resolve();
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  /**
   * Persistently enable every dependency of `record` (Vencord's semantics:
   * dependencies become enabled in settings, transitively, and a missing one
   * warns instead of blocking). Cycles terminate via `seen`.
   */
  const enableDependencies = (record: PluginRecord, seen = new Set<string>()): void => {
    for (const depName of record.definition.dependencies ?? []) {
      const dep = recordsByName.get(depName);
      if (!dep) {
        logger.warn(
          `plugin ${record.definition.name} has unresolved dependency ${JSON.stringify(depName)}`,
        );
        continue;
      }
      if (seen.has(dep.definition.id)) continue;
      seen.add(dep.definition.id);
      if (!isEnabled(dep.definition)) {
        writeEnabled(dep.definition, true);
        // A dependency enabled at runtime must get its patches too — the
        // boot-time pass already ran for plugins enabled back then.
        registerPatches(dep);
      }
      enableDependencies(dep, seen);
    }
  };

  /** Start `record` after its dependencies, recursively; cycles are skipped. */
  const startWithDependencies = async (
    record: PluginRecord,
    resolving: Set<string>,
  ): Promise<void> => {
    if (resolving.has(record.definition.id)) {
      logger.warn(`dependency cycle at plugin ${record.definition.name}`);
      return;
    }
    resolving.add(record.definition.id);
    for (const depName of record.definition.dependencies ?? []) {
      const dep = recordsByName.get(depName);
      if (dep && isEnabled(dep.definition)) await startWithDependencies(dep, resolving);
    }
    resolving.delete(record.definition.id);
    await startPlugin(record);
  };

  const startPlugin = async (record: PluginRecord): Promise<void> => {
    if (record.state !== "stopped" && record.state !== "failed") return;
    const { definition } = record;
    record.state = "starting";
    try {
      await definition.start?.(record.context);
      record.state = "started";
      record.error = undefined;
    } catch (error) {
      record.state = "failed";
      record.error = describeError(error);
      logger.error(`plugin ${definition.name} failed to start`, error);
    }
    notify();
  };

  /**
   * (Re)register a plugin's patches. Clearing first keeps a retry after a
   * failed start idempotent — re-enabling a still-registered patch set must
   * not double-register. Attribution by name (validated unique at
   * registration) so notices read like upstream's.
   */
  const registerPatches = (record: PluginRecord): void => {
    const { definition } = record;
    registry.removeByPlugin(definition.name);
    const patches = (definition.patches ?? []).map((patch) => ({
      ...patch,
      plugin: definition.name,
    }));
    if (patches.length > 0) registry.add(...patches);
  };

  const stopPlugin = async (record: PluginRecord): Promise<void> => {
    if (record.state !== "started" && record.state !== "failed") return;
    const { definition } = record;
    record.state = "stopping";
    try {
      // A failed start may have run half of `stop`'s counterpart work;
      // calling stop() anyway lets the plugin clean up what it can.
      await definition.stop?.(record.context);
    } catch (error) {
      record.error = describeError(error);
      logger.error(`plugin ${definition.name} failed to stop cleanly`, error);
    }
    registry.removeByPlugin(definition.name);
    record.state = "stopped";
    notify();
  };

  const info = (record: PluginRecord): IonPluginInfo => ({
    id: record.definition.id,
    name: record.definition.name,
    description: record.definition.description,
    authors: (record.definition.authors ?? []).map((author) =>
      author.id === undefined ? author.name : `${author.name} (${author.id})`,
    ),
    version: record.definition.version,
    enabled: isEnabled(record.definition),
    state: record.state,
    error: record.error,
  });

  return {
    register(definition) {
      assertId(definition.id);
      assertDisplayName(definition.name);
      if (records.has(definition.id)) {
        throw new Error(`plugin id already registered: ${definition.id}`);
      }
      for (const existing of records.values()) {
        if (existing.definition.name === definition.name) {
          throw new Error(`plugin name already registered: ${definition.name}`);
        }
      }
      const record: PluginRecord = {
        definition,
        context: {
          settings: settings.namespace(`plugin.${definition.id}`),
          log: createLogger(definition.name),
        },
        state: "stopped",
        error: undefined,
      };
      records.set(definition.id, record);
      recordsByName.set(definition.name, record);
      notify();
      // A plugin registered after boot (adapters, external files) starts
      // when enabled; its patches only affect modules that have not
      // evaluated yet, the same rule upstream follows. The stage still
      // gates the start itself: adapters register before Discord's first
      // script, so a webpack-ready or dom-ready plugin must not run its
      // start() yet (boot phase 2 applies the same staging).
      if (booted && isEnabled(definition)) {
        enableDependencies(record);
        registerPatches(record);
        void stageWaiter(definition.startAt ?? "init").then(() =>
          isEnabled(definition) ? startWithDependencies(record, new Set()) : undefined,
        );
      }
    },

    async boot() {
      if (booted) return;
      booted = true;

      // Resolve the enablement graph first: enabling a plugin also enables
      // its dependencies, which may not have been enabled before.
      for (const record of records.values()) {
        if (isEnabled(record.definition)) enableDependencies(record);
      }
      const enabled = [...records.values()].filter((record) => isEnabled(record.definition));

      // Dependency-first registration order (upstream starts APIs before
      // their users; patches follow the same graph).
      const ordered: PluginRecord[] = [];
      const seen = new Set<string>();
      const visit = (record: PluginRecord): void => {
        if (seen.has(record.definition.id)) return;
        seen.add(record.definition.id);
        for (const depName of record.definition.dependencies ?? []) {
          const dep = recordsByName.get(depName);
          if (dep && isEnabled(dep.definition)) visit(dep);
        }
        ordered.push(record);
      };
      for (const record of enabled) visit(record);

      // Phase 1 (synchronous): every enabled plugin's patches register
      // before anything can await. Feature registration may wait for a
      // stage (webpack-ready), but Discord's first script must already see
      // the full patch set.
      for (const record of ordered) registerPatches(record);

      // Phase 2: starts grouped by stage so an init plugin listed after a
      // webpack-ready one is not delayed by it — upstream processes each
      // stage as a separate pass as well.
      for (const stage of ["init", "webpack-ready", "dom-ready"] as const) {
        if (stage !== "init") await stageWaiter(stage);
        for (const record of ordered) {
          if ((record.definition.startAt ?? "init") !== stage) continue;
          // Re-check: a stage waiter yields, and the user may have
          // disabled the plugin in the meantime.
          if (!isEnabled(record.definition)) continue;
          await startWithDependencies(record, new Set());
        }
      }
    },

    async setEnabled(id, enabled) {
      const record = records.get(id);
      if (!record) throw new Error(`unknown plugin: ${id}`);
      if (record.definition.required === true && !enabled) {
        logger.warn(`plugin ${record.definition.name} is required and cannot be disabled`);
        return;
      }
      // Only write when the value actually changes: a foreign settings
      // store notifies its listeners synchronously, and re-writing the same
      // value from inside that listener would recurse forever. The state
      // checks below make a re-entrant call a no-op instead of a double
      // start/stop.
      if (isEnabled(record.definition) !== enabled) writeEnabled(record.definition, enabled);
      if (!booted) return;
      if (enabled) {
        if (record.state === "started" || record.state === "starting") return;
        enableDependencies(record);
        registerPatches(record);
        await startWithDependencies(record, new Set());
      } else {
        if (record.state === "stopped" || record.state === "stopping") return;
        await stopPlugin(record);
      }
    },

    list() {
      return [...records.values()].map(info);
    },

    status() {
      let started = 0;
      let failed = 0;
      for (const record of records.values()) {
        if (record.state === "started" || record.state === "starting") started++;
        else if (record.state === "failed") failed++;
      }
      return { registered: records.size, started, failed } satisfies IonPluginStatus;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
