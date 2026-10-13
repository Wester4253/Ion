/**
 * `BdApi` — BetterDiscord's global API surface, assembled the way upstream
 * assembles it (static class + per-plugin bound instances): the static
 * members take the plugin name as their first argument, while
 * `new BdApi(name)` returns a cached instance with Patcher/Data/DOM/Logger/
 * Commands/Hooks pre-scoped to that name.
 *
 * `React` and `ReactDOM` are static getters rather than the upstream's
 * load-time fields: Ion's bundle evaluates before Discord's webpack
 * runtime exists, so the values resolve on first access (identical module
 * objects once Discord has loaded).
 *
 * Members land as the adapter grows; see THIRD_PARTY.md for the
 * Apache-2.0 sources whose semantics this mirrors.
 */

import { getReact, getReactDOM, type BdReact, type BdReactDom } from "../modules/discord-modules";
import { PluginsApi, ThemesApi } from "./addonapi";
import { ContextMenu } from "./contextmenu";
import { Data, BoundData } from "./data";
import { DOM, BoundDOM } from "./dom";
import { BoundHooks, Hooks } from "./hooks";
import { Logger, boundLoggerFor, type BoundLogger } from "./logger";
import { BoundPatcher, Patcher } from "./patcher";
import { Net } from "./network";
import { ReactUtils } from "./reactutils";
import { UI } from "./ui";
import { Utils } from "./utils";
import { Webpack } from "./webpack";

/** The BetterDiscord release whose API surface this adapter implements. */
const BD_VERSION = "1.14.2";

const defaultLogger = new Logger();
const webpackInstance = new Webpack();
const patcherInstance = new Patcher();
const dataInstance = new Data();
const domInstance = new DOM();
const uiInstance = new UI();
const netInstance = new Net();
const reactUtilsInstance = new ReactUtils();
const contextMenuInstance = new ContextMenu();
const hooksInstance = new Hooks();
const pluginsApi = new PluginsApi();
const themesApi = new ThemesApi();
const instances = new Map<string, BdApi>();

export class BdApi {
  /** The BetterDiscord version this surface mirrors (plugins feature-detect on it). */
  static readonly version: string = BD_VERSION;
  /** The BetterDiscord version this surface mirrors (plugins feature-detect on it). */
  readonly version: string = BD_VERSION;

  /** Unbound logger: every call carries the plugin name first. */
  static readonly Logger: Logger = defaultLogger;

  /** Module search — shared instance, exactly as upstream (never name-bound). */
  static readonly Webpack: Webpack = webpackInstance;

  /** Monkey-patching: the static form takes the plugin name first. */
  static readonly Patcher: Patcher = patcherInstance;

  /** Plugin data: the static form takes the plugin name first. */
  static readonly Data: Data = dataInstance;

  /** DOM manipulation: the static form takes the plugin name first. */
  static readonly DOM: DOM = domInstance;

  /** Shared utilities — stateless, so upstream never name-binds them. */
  static readonly Utils: typeof Utils = Utils;

  /** An instance of {@link UI} to create interfaces. */
  static readonly UI: UI = uiInstance;

  /** Network access through the page's fetch. */
  static readonly Net: Net = netInstance;

  /** React internals. */
  static readonly ReactUtils: ReactUtils = reactUtilsInstance;

  /** Context menu patching and building. */
  static readonly ContextMenu: ContextMenu = contextMenuInstance;

  /** React hooks with plugin scoping. */
  static readonly Hooks: Hooks = hooksInstance;

  /** BetterDiscord's plugin manager (folder/enable/disable/...). */
  static readonly Plugins: PluginsApi = pluginsApi;

  /** BetterDiscord's theme manager (folder/enable/disable/...). */
  static readonly Themes: ThemesApi = themesApi;

  /** Discord's React, resolved on first access. */
  static get React(): BdReact | undefined {
    return getReact();
  }

  /** Discord's react-dom, resolved on first access. */
  static get ReactDOM(): BdReactDom | undefined {
    return getReactDOM();
  }

  readonly #scopedLogger: BoundLogger | null = null;
  readonly #scopedPatcher: BoundPatcher | null = null;
  readonly #scopedData: BoundData | null = null;
  readonly #scopedDOM: BoundDOM | null = null;
  readonly #scopedHooks: BoundHooks | null = null;

  /**
   * `new BdApi(name)` yields the plugin-scoped instance (cached, so repeat
   * constructions return the identical object as upstream). Calling without
   * a usable name keeps the generic surface — same behavior as upstream's
   * `return BdApi` fallback, since the generic instance's getters resolve to
   * the very objects the static members expose.
   */
  constructor(pluginName?: string) {
    if (pluginName !== undefined && typeof pluginName !== "string") {
      defaultLogger.error("BdApi", "Plugin name not a string, returning generic API!");
      this.#scopedLogger = null;
      return;
    }
    if (!pluginName) {
      this.#scopedLogger = null;
      return;
    }
    const cached = instances.get(pluginName);
    if (cached) return cached;

    this.#scopedLogger = boundLoggerFor(pluginName);
    this.#scopedPatcher = new BoundPatcher(pluginName);
    this.#scopedData = new BoundData(pluginName);
    this.#scopedDOM = new BoundDOM(pluginName);
    this.#scopedHooks = new BoundHooks(pluginName);
    instances.set(pluginName, this);
  }

  /**
   * Plugin-scoped logger. A named instance returns a `BoundLogger`; the
   * generic instance keeps the static logger's shape, matching upstream.
   */
  get Logger(): BoundLogger | Logger {
    return this.#scopedLogger ?? defaultLogger;
  }

  /** Module search — shared instance, exactly as upstream (never name-bound). */
  get Webpack(): Webpack {
    return webpackInstance;
  }

  /**
   * Monkey-patcher. A named instance patches under that name; the generic
   * instance keeps the unbound patcher — cast to the bound shape exactly as
   * upstream casts it, so its methods still take the plugin name.
   */
  get Patcher(): BoundPatcher {
    return this.#scopedPatcher ?? (patcherInstance as unknown as BoundPatcher);
  }

  /**
   * Plugin data. A named instance reads and writes that plugin's store; the
   * generic instance keeps the unbound surface — cast the way upstream
   * casts it — so its methods still take the plugin name.
   */
  get Data(): BoundData {
    return this.#scopedData ?? (dataInstance as unknown as BoundData);
  }

  /**
   * DOM manipulation. A named instance scopes style ids to the plugin name;
   * the generic instance keeps the unbound surface, as upstream does.
   */
  get DOM(): BoundDOM {
    return this.#scopedDOM ?? (domInstance as unknown as BoundDOM);
  }

  /** Shared utilities — stateless, so upstream never name-binds them. */
  get Utils(): typeof Utils {
    return Utils;
  }

  /** An instance of {@link UI} to create interfaces. */
  get UI(): UI {
    return uiInstance;
  }

  /** Network access through the page's fetch. */
  get Net(): Net {
    return netInstance;
  }

  /** React internals. */
  get ReactUtils(): ReactUtils {
    return reactUtilsInstance;
  }

  /** Context menu patching and building. */
  get ContextMenu(): ContextMenu {
    return contextMenuInstance;
  }

  /**
   * React hooks. A named instance scopes `useData` to that plugin; the
   * generic instance keeps the unbound surface, cast the way upstream
   * casts it so `useData` takes the plugin name.
   */
  get Hooks(): BoundHooks {
    return this.#scopedHooks ?? (hooksInstance as unknown as BoundHooks);
  }

  /** BetterDiscord's plugin manager — shared, never name-bound. */
  get Plugins(): PluginsApi {
    return pluginsApi;
  }

  /** BetterDiscord's theme manager — shared, never name-bound. */
  get Themes(): ThemesApi {
    return themesApi;
  }

  /** Discord's React, resolved on first access. */
  get React(): BdReact | undefined {
    return getReact();
  }

  /** Discord's react-dom, resolved on first access. */
  get ReactDOM(): BdReactDom | undefined {
    return getReactDOM();
  }
}

// Upstream freezes both, so plugins cannot clobber the shared surfaces.
Object.freeze(BdApi);
Object.freeze(BdApi.prototype);
