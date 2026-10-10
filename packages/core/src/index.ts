/**
 * Ion core entry point.
 *
 * This file is bundled (IIFE) and evaluated in the page's main world by the
 * sandboxed preload before any Discord script runs. Everything the core needs
 * from the host arrives through `window.ionShell` (see platform/shell.ts).
 */

import { mountDebugPanel } from "./debugPanel";
import type { IonGlobal } from "./platform/shell";

export type {
  FileEncoding,
  IonGlobal,
  ShellFileApi,
  ShellHost,
  ShellKind,
  ShellRequire,
  ShellSettingsApi,
} from "./platform/shell";

const state: IonGlobal = {
  version: window.ionShell?.appVersion ?? "unknown",
  startedAt: performance.now(),
};

window.__ION__ = state;
mountDebugPanel();
