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
import { createPluginHost } from "./plugins";
import type { IonGlobal, IonWebpackStatus, ShellFileApi } from "./platform/shell";
import { createSettingsStore } from "./settings";
import { getPatchRegistry, initWebpack, probeHealth } from "./webpack";

export type {
  FileEncoding,
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

const settings = createSettingsStore(window.ionShell?.files ?? UNAVAILABLE_FILES);
const host = createPluginHost({ registry: getPatchRegistry(), settings });
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
    if (!settled && ticks < HEALTH_POLL_LIMIT) {
      window.setTimeout(tick, HEALTH_POLL_INTERVAL_MS);
    }
  };

  tick();
}
