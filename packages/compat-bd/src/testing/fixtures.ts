/**
 * Test-only fixtures shared by the adapter's suites: one fake shell, one
 * fake plugin host with upstream's uniqueness rules, one fake theme store,
 * and the plugin-source builders the loader tests read.
 *
 * The bundle entry never imports this file — it exists so the suites agree
 * on what `window.ionShell` and `window.__ION__` look like instead of each
 * growing its own copy. The fakes are faithful where it matters: enabling a
 * plugin runs its lifecycle, and the theme store resolves by id, name, or
 * filename like the real one.
 */

import type {
  IonPlugin,
  IonPluginContext,
  IonPluginInfo,
  IonPluginsApi,
  IonTheme,
  IonThemesApi,
} from "@ion/core";

export interface Counters {
  events: string[];
  started: number;
  stopped: number;
}

export const testGlobal = globalThis as { bdCounters?: Counters };

/** The host passes a context to start/stop; the fixtures' fakes ignore it. */
export const ctx = {} as IonPluginContext;

/** Restores the counters the fixture plugin sources bump. */
export function resetCounters(): Counters {
  const fresh: Counters = { events: [], started: 0, stopped: 0 };
  testGlobal.bdCounters = fresh;
  return fresh;
}

/** Builds a realistic BD plugin file: meta header plus a body. */
export function pluginSource(name: string, body: string, extraTags = ""): string {
  return `/**
 * @name ${name}
 * @version 1.0.0
 * @description Test fixture
 * @author Tester${extraTags}
 */
${body}
`;
}

/** A plugin that counts start/stop calls through the shared counters. */
export const CLASS_BODY = `module.exports = class {
  start() { globalThis.bdCounters.started++; }
  stop() { globalThis.bdCounters.stopped++; }
};`;

/** A class-shaped plugin whose single method is provided by the test. */
export function classBody(method: string): string {
  return `module.exports = class {
  constructor(meta) { this.meta = meta; }
  start() {}
  stop() {}
  ${method}
};`;
}

/** Stands in for `window.ionShell`: reads from an in-memory file map
 *  keyed by basename (so both `bd/plugins` and `bd/themes` work). */
export function installShell(files: Record<string, string> | undefined): void {
  const shell = {
    files: {
      readdir: (): Promise<string[]> =>
        files === undefined
          ? Promise.reject(new Error("ENOENT"))
          : Promise.resolve(Object.keys(files)),
      readFile: (path: string): Promise<string> => {
        const content = files?.[path.slice(path.lastIndexOf("/") + 1)];
        return content === undefined
          ? Promise.reject(new Error(`ENOENT: ${path}`))
          : Promise.resolve(content);
      },
    },
  };
  Object.defineProperty(window, "ionShell", { configurable: true, value: shell });
}

/**
 * A minimal host with upstream's uniqueness rules: duplicate ids and
 * display names throw, exactly like `createPluginHost`. Toggling runs the
 * plugin's lifecycle and records the result the way core does — a `start()`
 * that throws leaves `state: "failed"` with the message in `error`, which is
 * the field `BdApi.Plugins.enable()` and the compat harness both read.
 * Returns the registered plugins for assertions.
 */
export function installHost(...preRegistered: IonPlugin[]): IonPlugin[] {
  const registered: IonPlugin[] = [...preRegistered];
  const enabled = new Map<string, boolean>(
    registered.map((plugin) => [plugin.id, plugin.defaultEnabled ?? true]),
  );
  /** Per-plugin lifecycle state, mirroring core's `PluginRecord.state`. */
  const states = new Map<string, IonPluginInfo["state"]>();
  const errors = new Map<string, string>();
  for (const plugin of registered) {
    states.set(plugin.id, (enabled.get(plugin.id) ?? true) ? "started" : "stopped");
  }
  const toInfo = (plugin: IonPlugin): IonPluginInfo => {
    const isEnabled = enabled.get(plugin.id) ?? true;
    return {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      authors: plugin.authors?.map((author) => author.name) ?? [],
      version: plugin.version,
      enabled: isEnabled,
      state: states.get(plugin.id) ?? (isEnabled ? "started" : "stopped"),
      error: errors.get(plugin.id),
    };
  };
  /** Runs a lifecycle hook, recording a rejection the way core's host does. */
  const runLifecycle = async (plugin: IonPlugin, hook: "start" | "stop"): Promise<void> => {
    try {
      // Awaiting matches core's `await definition.start?.(...)`: it records
      // a rejection from an async start as a failure, not as a success.
      await plugin[hook]?.(ctx);
      errors.delete(plugin.id);
      states.set(plugin.id, hook === "start" ? "started" : "stopped");
    } catch (error) {
      states.set(plugin.id, "failed");
      errors.set(plugin.id, error instanceof Error ? error.message : String(error));
    }
  };
  const api: IonPluginsApi = {
    register(plugin) {
      if (registered.some((entry) => entry.id === plugin.id)) {
        throw new Error(`plugin id already registered: ${plugin.id}`);
      }
      if (registered.some((entry) => entry.name === plugin.name)) {
        throw new Error(`plugin name already registered: ${plugin.name}`);
      }
      registered.push(plugin);
      enabled.set(plugin.id, plugin.defaultEnabled ?? true);
      states.set(plugin.id, "stopped");
    },
    list: () => registered.map(toInfo),
    setEnabled(id, next) {
      const plugin = registered.find((entry) => entry.id === id);
      if (!plugin) return Promise.reject(new Error(`unknown plugin: ${id}`));
      enabled.set(id, next);
      // Mirror the real host: toggling runs the plugin's lifecycle.
      return runLifecycle(plugin, next ? "start" : "stop");
    },
    status: () => {
      const infos = registered.map(toInfo);
      return {
        registered: infos.length,
        started: infos.filter((info) => info.state === "started" || info.state === "starting")
          .length,
        failed: infos.filter((info) => info.state === "failed").length,
      };
    },
    subscribe: () => () => undefined,
  };
  const current = window.__ION__ ?? {};
  Object.defineProperty(window, "__ION__", {
    configurable: true,
    value: { ...current, plugins: api },
  });
  return registered;
}

export interface FakeThemeStore {
  readonly api: IonThemesApi;
  readonly registered: IonTheme[];
  readonly unregistered: string[];
  /** Names whose `register()` throws, to exercise collision handling. */
  readonly failRegisterNames: Set<string>;
}

/** An in-memory stand-in for `window.__ION__.themes`. */
export function fakeThemeStore(): FakeThemeStore {
  const registered: IonTheme[] = [];
  const unregistered: string[] = [];
  const enabled = new Map<string, boolean>();
  const failRegisterNames = new Set<string>();

  const resolve = (idOrNameOrFilename: string): IonTheme | undefined =>
    registered.find(
      (theme) =>
        theme.id === idOrNameOrFilename ||
        theme.name === idOrNameOrFilename ||
        theme.filename === idOrNameOrFilename,
    );

  const api: IonThemesApi = {
    register(theme) {
      if (failRegisterNames.has(theme.name)) {
        throw new Error(`theme name already registered: ${theme.name}`);
      }
      registered.push(theme);
    },
    unregister(idOrNameOrFilename) {
      const theme = resolve(idOrNameOrFilename);
      if (!theme) return false;
      unregistered.push(theme.id);
      registered.splice(registered.indexOf(theme), 1);
      return true;
    },
    get: (idOrNameOrFilename) => resolve(idOrNameOrFilename),
    list: () =>
      registered.map((theme) => ({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        authors: theme.authors ?? [],
        version: theme.version,
        filename: theme.filename,
        enabled: enabled.get(theme.id) ?? true,
      })),
    isEnabled: (idOrNameOrFilename) => {
      const theme = resolve(idOrNameOrFilename);
      return theme !== undefined && (enabled.get(theme.id) ?? true);
    },
    setEnabled: (idOrNameOrFilename, next) => {
      const theme = resolve(idOrNameOrFilename);
      if (!theme) return false;
      enabled.set(theme.id, next);
      return true;
    },
    subscribe: () => () => undefined,
  };

  return { api, registered, unregistered, failRegisterNames };
}

/** Publishes a fake store as `window.__ION__.themes` (keeping plugins). */
export function installThemes(store: FakeThemeStore): void {
  const current = window.__ION__ ?? {};
  Object.defineProperty(window, "__ION__", {
    configurable: true,
    value: { ...current, themes: store.api },
  });
}
