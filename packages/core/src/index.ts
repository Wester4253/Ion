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

import { mountDebugPanel, updateWebpackStatus } from "./debugPanel";
import type { IonGlobal, IonWebpackStatus } from "./platform/shell";
import { initWebpack, probeHealth } from "./webpack";

export type {
  FileEncoding,
  IonGlobal,
  IonWebpackStatus,
  ShellFileApi,
  ShellHost,
  ShellKind,
  ShellRequire,
  ShellSettingsApi,
} from "./platform/shell";

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
  initWebpack,
  probeHealth,
  registerPatches,
  search,
  waitFor,
} from "./webpack";

/** How long the health poll runs before settling on the last snapshot. */
const HEALTH_POLL_LIMIT = 30;
const HEALTH_POLL_INTERVAL_MS = 1_000;

const state: IonGlobal = {
  version: window.ionShell?.appVersion ?? "unknown",
  startedAt: performance.now(),
};

window.__ION__ = state;

initWebpack();
mountDebugPanel();
startHealthPoll();

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
