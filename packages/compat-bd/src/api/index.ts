/**
 * `BdApi` — BetterDiscord's global API surface, assembled the way upstream
 * assembles it (static class + per-plugin bound instances): the static
 * members take the plugin name as their first argument, while
 * `new BdApi(name)` returns a cached instance with Patcher/Data/DOM/Logger/
 * Commands/Hooks pre-scoped to that name.
 *
 * Members land as the adapter grows; see THIRD_PARTY.md for the
 * Apache-2.0 sources whose semantics this mirrors.
 */

import { Logger, boundLoggerFor, type BoundLogger } from "./logger";
import { BoundPatcher, Patcher } from "./patcher";
import { Webpack } from "./webpack";

/** The BetterDiscord release whose API surface this adapter implements. */
const BD_VERSION = "1.14.2";

const defaultLogger = new Logger();
const webpackInstance = new Webpack();
const patcherInstance = new Patcher();
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

  readonly #scopedLogger: BoundLogger | null = null;
  readonly #scopedPatcher: BoundPatcher | null = null;

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
}

// Upstream freezes both, so plugins cannot clobber the shared surfaces.
Object.freeze(BdApi);
Object.freeze(BdApi.prototype);
