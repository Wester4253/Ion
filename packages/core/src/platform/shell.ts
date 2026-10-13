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
import type { Patch, PatchStatsApi } from "../patches";
import type { PluginSettings } from "../settings";
import type { DomStorage } from "../storage";
import type { CodeFilter, ModuleFilter } from "../webpack/filters";
import type { ModuleFactory, WebpackRequire } from "../webpack/types";

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
  readonly authors?: readonly { readonly name: string; readonly id?: string }[] | undefined;
  readonly version?: string | undefined;
  /** Enabled unless the user disabled it; defaults to true. */
  readonly defaultEnabled?: boolean | undefined;
  /**
   * Force-enabled and hidden from toggling (Vencord's `required`): core
   * runtime plugins that other plugins assume present.
   */
  readonly required?: boolean | undefined;
  /**
   * Other plugins (by name) this one needs: starting an enabled plugin
   * enables its dependencies first, exactly like upstream's dependency
   * resolution. A missing dependency logs a warning and is skipped.
   */
  readonly dependencies?: readonly string[] | undefined;
  /**
   * Source patches, registered with the engine before Discord evaluates its
   * modules. Already-evaluated modules are never affected by late patches.
   */
  readonly patches?: readonly IonPluginPatch[] | undefined;
  /**
   * When `start()` runs relative to Discord's boot:
   * - `undefined` (default): as soon as the host boots — for Ion's own
   *   plugins and upstream `Init` plugins, still before any Discord script,
   * - `webpack-ready`: after webpack discovery succeeded (`onceReady`),
   *   for upstream plugins defaulting to `WebpackReady`,
   * - `dom-ready`: after the document finished parsing.
   *
   * Patches register regardless of the stage, at boot, before Discord
   * evaluates anything — only feature registration waits for the stage.
   */
  readonly startAt?: "init" | "webpack-ready" | "dom-ready" | undefined;
  /**
   * Persisted enablement owned by a foreign plugin format's own settings
   * store (Vencord keeps `Settings.plugins.<name>.enabled`). When present,
   * the host reads and writes enablement through this seam instead of its
   * own store, so the adapter's UI and the host never disagree. `read()`
   * returning undefined falls back to `defaultEnabled`.
   */
  readonly enabledState?: {
    read(): boolean | undefined;
    write(enabled: boolean): void;
  };
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

/** A theme as adapters hand it to the theme store. */
export interface IonTheme {
  /** Stable unique id; no whitespace (also the settings namespace). */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly authors?: readonly string[] | undefined;
  readonly version?: string | undefined;
  /** The file this theme was read from, relative to its directory. */
  readonly filename: string;
  readonly css: string;
}

/** A theme as shown in the UI: identity plus live enablement. */
export interface IonThemeInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly authors: readonly string[];
  readonly version?: string | undefined;
  readonly filename: string;
  readonly enabled: boolean;
}

/**
 * Registration and inspection surface, exposed as `window.__ION__.themes`.
 * One store owns every theme regardless of which adapter found it.
 */
export interface IonThemesApi {
  /** Adds a theme; throws on an invalid or duplicate id/name. */
  register(theme: IonTheme): void;
  /**
   * Removes a theme (its persisted enablement is kept, so re-registering
   * the same id restores the previous state). False when unknown.
   */
  unregister(idOrNameOrFilename: string): boolean;
  get(idOrNameOrFilename: string): IonTheme | undefined;
  list(): readonly IonThemeInfo[];
  isEnabled(idOrNameOrFilename: string): boolean;
  /** Toggle at runtime: injects or removes the theme's style. False when unknown. */
  setEnabled(idOrNameOrFilename: string, enabled: boolean): boolean;
  /** Fired whenever a theme is registered, removed, or toggled. */
  subscribe(listener: () => void): () => void;
}

/**
 * The module-discovery surface, exposed as `window.__ION__.discovery`.
 *
 * Adapters (compat-vencord, compat-bd, ...) must not bundle core a second
 * time — that would duplicate the patch registry and plugin host — so they
 * import nothing at runtime and call these functions instead. Semantics are
 * identical to the core exports of the same names.
 */
export interface IonDiscoveryApi {
  /** First loaded module (or nested export) matching the filter. */
  find(filter: ModuleFilter, options?: { readonly topLevelOnly?: boolean }): unknown;
  /** All loaded modules (or nested exports) matching the filter. */
  findAll(filter: ModuleFilter, options?: { readonly topLevelOnly?: boolean }): unknown[];
  /** First module exposing all the given properties (logs a warning on miss). */
  findByProps(...props: string[]): unknown;
  /** First function whose source contains all fragments (logs on miss). */
  findByCode(...code: CodeFilter): unknown;
  /** Flux store by constructor displayName (logs a warning on miss). */
  findStore(name: string): unknown;
  /** Id of the first module factory containing all fragments, else null. */
  findModuleId(...code: CodeFilter): string | null;
  /** The first module factory containing all fragments, else null. */
  findModuleFactory(...code: CodeFilter): ModuleFactory | null;
  /** Search factory sources; returns every matching id → factory. */
  search(...code: CodeFilter): Record<string, ModuleFactory>;
  /**
   * Every captured `__webpack_require__` instance (one per bundler runtime).
   * Adapters emulate upstream APIs that require a module by id on top of
   * these.
   */
  getRequires(): readonly WebpackRequire[];
  /** Call `listener` with the first matching module; returns unsubscribe. */
  waitFor(
    filter: string | readonly string[] | ModuleFilter,
    listener: (exports: unknown, id: PropertyKey) => void,
  ): () => void;
  /** Lazy variants: evaluate on first access, retry, never log on miss. */
  findLazy(filter: ModuleFilter): unknown;
  findByPropsLazy(...props: string[]): unknown;
  findByCodeLazy(...code: CodeFilter): unknown;
  findStoreLazy(name: string): unknown;
  /** Filters in Vencord's public shape (byProps/byCode/byStoreName). */
  readonly filters: {
    byProps(...props: string[]): ModuleFilter;
    byCode(...code: CodeFilter): ModuleFilter;
    byStoreName(name: string): ModuleFilter;
  };
  /** Evaluate `factory` on first property access and retry on failure. */
  proxyLazy<T>(factory: () => T, attempts?: number): T;
  /**
   * Resolves once Discord's webpack runtime was captured and sample
   * lookups succeeded — the adapter's stand-in for upstream's `onceReady`.
   */
  readonly onceReady: Promise<void>;
}

/** Injected by the core bundle as proof that it ran in the main world. */
export interface IonGlobal {
  readonly version: string;
  readonly startedAt: number;
  webpack?: IonWebpackStatus;
  plugins?: IonPluginsApi;
  /** The theme store adapters register their themes with. */
  themes?: IonThemesApi;
  /** Per-plugin patch telemetry (applied/active/notices) for the harness. */
  patches?: PatchStatsApi;
  /** Module discovery for adapters, which must not re-bundle the core. */
  discovery?: IonDiscoveryApi;
  /**
   * DOM storage, captured while `window.localStorage` still existed. Adapters
   * persist through this instead of the window property the page deletes.
   */
  storage: DomStorage;
  ui?: IonUiApi;
}

declare global {
  interface Window {
    /** Present whenever the Ion preload ran; absent means a broken shell. */
    ionShell?: ShellHost;
    __ION__?: IonGlobal;
  }
}
