/**
 * The contract between platform-neutral core code and whatever shell hosts it.
 *
 * Core defines what it needs; `shell-desktop` (Electron) and a future
 * `shell-android` (WebView) provide implementations. Nothing in core may
 * import Electron or Node — the shell passes its implementation in.
 *
 * The concrete instance is exposed to the injected core bundle as
 * `window.ionShell` by the sandboxed preload.
 */

import type { Logger } from "../logging";
import type { Patch } from "../patches";
import type { PluginSettings } from "../settings";

export type ShellKind = "desktop" | "android";

export type FileEncoding = "utf8" | "base64";

/** Persistence for shell-level settings (window, tray, GPU, ...). */
export interface ShellSettingsApi {
  getAll(): Promise<Record<string, unknown>>;
  /** Returns false when the key or value was refused. */
  set(key: string, value: unknown): Promise<boolean>;
}

/**
 * File access scoped to the Ion data directory. Paths are relative to that
 * root; absolute paths and `..` escapes are refused by the shell.
 */
export interface ShellFileApi {
  /** Reads a file. Rejects when missing, out of scope, or unreadable. */
  readFile(path: string, encoding?: FileEncoding): Promise<string>;
  /** Writes a file, creating parent directories. Rejects out-of-scope paths. */
  writeFile(path: string, data: string, encoding?: FileEncoding): Promise<void>;
  /** Lists a directory. Rejects when missing or out of scope. */
  readdir(path: string): Promise<string[]>;
  /** Creates a directory (and parents). Rejects out-of-scope paths. */
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/**
 * Restricted Node-style `require` for plugin code (BetterDiscord plugins
 * expect it). Allowlisted modules only; anything else throws. Implemented by
 * the shell over its IPC bridge with `nodeIntegration` staying off.
 */
export type ShellRequire = (id: string) => unknown;

export interface ShellHost {
  readonly kind: ShellKind;
  readonly appVersion: string;

  /**
   * Open a URL with the system handler (browser, mail client).
   * Resolves when the request was handed off, rejects when refused as unsafe.
   */
  openExternal(url: string): Promise<void>;

  readonly settings: ShellSettingsApi;
  readonly files: ShellFileApi;
  readonly nodeRequire: ShellRequire;
}

/** Live webpack discovery status, polled for the debug panel and smoke report. */
export interface IonWebpackStatus {
  /** The chunk hook is installed on `webpackChunkdiscord_app`. */
  readonly hooked: boolean;
  /** `__webpack_require__` was captured from a running factory. */
  readonly ready: boolean;
  /** Factories seen on the chunk stream so far. */
  readonly factories: number;
  /** Modules evaluated so far. */
  readonly cache: number;
  /** Sample `findByProps` probe succeeded (module discovery works). */
  readonly byProps: boolean;
  /** Sample `findStore` probe succeeded (store discovery works). */
  readonly store: boolean;
}

/**
 * A patch a plugin contributes. The host injects the `plugin` attribution
 * string before handing the patch to the engine.
 */
export type IonPluginPatch = Omit<Patch, "plugin">;

/** What a plugin may use from its host while running. */
export interface IonPluginContext {
  /** Settings scoped under `plugin.<id>.*`. */
  readonly settings: PluginSettings;
  /** A logger prefixed with the plugin's name. */
  readonly log: Logger;
}

/**
 * The native Ion plugin manifest. The shape deliberately mirrors Vencord's
 * plugin definition so ports are mechanical; see docs/plugin-authoring.md.
 */
export interface IonPlugin {
  /** Stable unique id; also the settings namespace. */
  readonly id: string;
  /** Display name; must be unique (patch notices are attributed by it). */
  readonly name: string;
  readonly description: string;
  readonly authors?: readonly { readonly name: string; readonly id?: string }[];
  readonly version?: string;
  /** Enabled unless the user disabled it; defaults to true. */
  readonly defaultEnabled?: boolean;
  /**
   * Source patches, registered with the engine before Discord evaluates its
   * modules. Already-evaluated modules are never affected by late patches.
   */
  readonly patches?: readonly IonPluginPatch[];
  readonly start?: (context: IonPluginContext) => void | Promise<void>;
  readonly stop?: (context: IonPluginContext) => void | Promise<void>;
}

export type IonPluginState = "stopped" | "starting" | "started" | "stopping" | "failed";

/** A plugin as shown in the UI: identity plus live lifecycle state. */
export interface IonPluginInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly authors: readonly string[];
  readonly version?: string | undefined;
  readonly enabled: boolean;
  readonly state: IonPluginState;
  readonly error?: string | undefined;
}

export interface IonPluginStatus {
  readonly registered: number;
  readonly started: number;
  readonly failed: number;
}

/** Registration and inspection surface, exposed as `window.__ION__.plugins`. */
export interface IonPluginsApi {
  register(plugin: IonPlugin): void;
  list(): readonly IonPluginInfo[];
  /** Toggle at runtime: starts/stops the plugin and (un)registers patches. */
  setEnabled(id: string, enabled: boolean): Promise<void>;
  status(): IonPluginStatus;
  /** Fired whenever any plugin's state or enabled flag changes. */
  subscribe(listener: () => void): () => void;
}

/** UI readiness, exposed once the settings integration has initialized. */
export interface IonUiApi {
  readonly ready: boolean;
}

/** Injected by the core bundle as proof that it ran in the main world. */
export interface IonGlobal {
  readonly version: string;
  readonly startedAt: number;
  webpack?: IonWebpackStatus;
  plugins?: IonPluginsApi;
  ui?: IonUiApi;
}

declare global {
  interface Window {
    /** Present whenever the Ion preload ran; absent means a broken shell. */
    ionShell?: ShellHost;
    __ION__?: IonGlobal;
  }
}
