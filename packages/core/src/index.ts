/**
 * Ion core entry point.
 *
 * This file is bundled (IIFE) and evaluated in the page's main world by the
 * sandboxed preload before any Discord script runs. Everything the core needs
 * from the host arrives through `window.ionShell` (see platform/shell.ts).
 *
 * Boot order matters: the webpack chunk hook must be installed before any
 * Discord script pushes a chunk, and only after that do we mount UI and start
 * the health poll.
 */

import { registerBundledPlugins } from "./bundledPlugins";
import { mountDebugPanel, updatePluginStatus, updateWebpackStatus } from "./debugPanel";
import { proxyLazy } from "./lazy";
import { createPluginHost } from "./plugins";
import type { IonDiscoveryApi, IonGlobal, IonWebpackStatus, ShellFileApi } from "./platform/shell";
import { createSettingsStore } from "./settings";
import {
  find,
  findAll,
  findByCode,
  findByCodeLazy,
  findByProps,
  findByPropsLazy,
  findLazy,
  findModuleFactory,
  findModuleId,
  findStore,
  findStoreLazy,
  getPatchRegistry,
  getRequires,
  initWebpack,
  probeHealth,
  search,
  waitFor,
} from "./webpack";
import { filters } from "./webpack/filters";

export type {
  FileEncoding,
  IonDiscoveryApi,
  IonGlobal,
  IonPlugin,
  IonPluginContext,
  IonPluginInfo,
  IonPluginPatch,
  IonPluginState,
  IonPluginStatus,
  IonPluginsApi,
  IonUiApi,
  IonWebpackStatus,
  ShellFileApi,
  ShellHost,
  ShellKind,
  ShellRequire,
  ShellSettingsApi,
} from "./platform/shell";

export { createPluginHost, type PluginHost } from "./plugins";
export type { Patch, PatchNotice, PatchStatsApi, PluginPatchStats } from "./patches";
export { createSettingsStore, type PluginSettings, type SettingsStore } from "./settings";

export {
  find,
  findAll,
  findLazy,
  findModuleFactory,
  findModuleId,
  findByCode,
  findByCodeLazy,
  findByProps,
  findByPropsLazy,
  findStore,
  findStoreLazy,
  getPatchRegistry,
  initWebpack,
  probeHealth,
  registerPatches,
  search,
  waitFor,
} from "./webpack";

/** How long the health poll runs before settling on the last snapshot. */
const HEALTH_POLL_LIMIT = 30;
const HEALTH_POLL_INTERVAL_MS = 1_000;

/**
 * Used when the shell bridge is missing: reads fail closed, writes are
 * dropped with a logged error — plugins fall back to their defaults.
 */
const UNAVAILABLE_FILES: ShellFileApi = {
  readFile() {
    return Promise.reject(new Error("shell bridge unavailable"));
  },
  writeFile() {
    return Promise.reject(new Error("shell bridge unavailable"));
  },
  readdir() {
    return Promise.reject(new Error("shell bridge unavailable"));
  },
  mkdir() {
    return Promise.reject(new Error("shell bridge unavailable"));
  },
  exists() {
    return Promise.resolve(false);
  },
};

const state: IonGlobal = {
  version: window.ionShell?.appVersion ?? "unknown",
  startedAt: performance.now(),
};

window.__ION__ = state;

/**
 * Resolves on the first health snapshot where the webpack runtime was
 * captured and sample lookups succeed — adapters await it before their
 * eager (non-lazy) module lookups.
 */
let markWebpackReady!: () => void;
const webpackReady = new Promise<void>((resolve) => {
  markWebpackReady = resolve;
});

/** Discovery surface for adapters; see `IonDiscoveryApi`. */
const discovery: IonDiscoveryApi = {
  find: (filter, options) => find(filter, options),
  findAll: (filter) => findAll(filter),
  findByProps: (...props) => findByProps(...props),
  findByCode: (...code) => findByCode(...code),
  findStore: (name) => findStore(name),
  findModuleId: (...code) => findModuleId(...code),
  findModuleFactory: (...code) => findModuleFactory(...code),
  search: (...code) => search(...code),
  getRequires: () => getRequires(),
  waitFor: (filter, listener) => waitFor(filter, listener),
  findLazy: (filter) => findLazy(filter),
  findByPropsLazy: (...props) => findByPropsLazy(...props),
  findByCodeLazy: (...code) => findByCodeLazy(...code),
  findStoreLazy: (name) => findStoreLazy(name),
  filters,
  proxyLazy,
  onceReady: webpackReady,
};
state.discovery = discovery;

const settings = createSettingsStore(window.ionShell?.files ?? UNAVAILABLE_FILES);
const host = createPluginHost({
  registry: getPatchRegistry(),
  settings,
  stages: {
    "webpack-ready": () => webpackReady,
    "dom-ready": () =>
      document.readyState === "loading"
        ? new Promise<void>((resolve) => {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                resolve();
              },
              { once: true },
            );
          })
        : Promise.resolve(),
  },
});
state.plugins = host;
state.patches = { stats: () => getPatchRegistry().stats() };

initWebpack();
mountDebugPanel();
startHealthPoll();
bootPlugins();

/**
 * Load settings, register the bundled plugins, and start everything
 * enabled. The file bridge is synchronous IPC behind a promise, so this
 * resolves within microtasks — before Discord's first script runs, which
 * means plugin patches register before any module evaluates.
 */
function bootPlugins(): void {
  registerBundledPlugins(host);
  void (async () => {
    await settings.load();
    await host.boot();
    updatePluginStatus(host.status());
    host.subscribe(() => {
      updatePluginStatus(host.status());
    });
  })();
}

function startHealthPoll(): void {
  let ticks = 0;

  const tick = (): void => {
    ticks += 1;
    const status: IonWebpackStatus = probeHealth();
    state.webpack = status;
    updateWebpackStatus(status);

    const settled = status.ready && status.byProps && status.store;
    // Settled or exhausted: either way the poll is done. `onceReady` must
    // resolve even when discovery never succeeded, so awaiting adapters
    // proceed (and report their own misses) instead of hanging forever.
    if (settled || ticks >= HEALTH_POLL_LIMIT) {
      markWebpackReady();
      return;
    }
    window.setTimeout(tick, HEALTH_POLL_INTERVAL_MS);
  };

  tick();
}
