/**
 * Page-side evaluation of BetterDiscord plugin files.
 *
 * Upstream `PluginManager.initAddon` runs plugin source through a
 * `new Function("require", "module", "exports", "__filename", "__dirname",
 * source)` shim against Discord's Node-ish require. Ion has no Node in the
 * page, so `require` is an honest shim that throws with the module id — a
 * plugin that needs Node modules fails at load with that reason instead of
 * getting a half-working environment. The `module.exports.default` unwrap
 * and the sourceURL label are upstream's, byte for byte (Apache-2.0, see
 * THIRD_PARTY.md).
 */

import type { BdAddonMeta } from "./meta";

type Listener = (...args: unknown[]) => void;

/**
 * The slice of Node's `EventEmitter` BetterDiscord plugins actually use.
 *
 * Measured against the starter set: BlurNSFW constructs an emitter as an
 * event bus and ChannelTabs subclasses it for a store, and every plugin
 * reaches only these members. It is pure in-memory bookkeeping — no file,
 * network, or process access — so it grants plugins no capability they do
 * not already have through the page. Members it does not implement
 * (`removeAllListeners`, `prependListener`, `prependOnceListener`, …) throw
 * by name rather than silently missing, so a plugin needing more fails with
 * a reason instead of misbehaving quietly. `getMaxListeners` and
 * `setMaxListeners` are accepted no-ops: they only configure a warning
 * threshold Node applies, and this emitter has none to breach.
 */
class PageEventEmitter {
  readonly #listeners = new Map<string, Listener[]>();

  /** Mirrors Node: the first `error` listener that is not attached throws. */
  emit(event: string, ...args: unknown[]): boolean {
    const listeners = this.#listeners.get(event);
    if (!listeners || listeners.length === 0) {
      if (event === "error") {
        throw new Error("Unhandled 'error' event: no listeners registered");
      }
      return false;
    }
    // Node calls a snapshot, so listeners removed during dispatch still run.
    for (const listener of [...listeners]) listener(...args);
    return true;
  }

  on(event: string, listener: Listener): this {
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function");
    }
    const listeners = this.#listeners.get(event);
    if (listeners) listeners.push(listener);
    else this.#listeners.set(event, [listener]);
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapped: Listener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, listener: Listener): this {
    const listeners = this.#listeners.get(event);
    if (!listeners) return this;
    const index = listeners.indexOf(listener);
    if (index !== -1) listeners.splice(index, 1);
    if (listeners.length === 0) this.#listeners.delete(event);
    return this;
  }

  #unsupported(member: string): never {
    throw new Error(`EventEmitter.${member}() is not implemented in Ion's page-side events shim`);
  }

  /** True Node alias, so plugins written either way behave identically. */
  addListener(event: string, listener: Listener): this {
    return this.on(event, listener);
  }

  removeListener(event: string, listener: Listener): this {
    return this.off(event, listener);
  }

  /**
   * Node's overload clears every event when called with none. This shim
   * refuses instead of doing less than the call asked for, so the failure
   * is the member rather than a half-applied mutation. The event name is
   * part of Node's signature but not of a refusal.
   */
  removeAllListeners(): this {
    return this.#unsupported("removeAllListeners");
  }

  listenerCount(event: string): number {
    return this.#listeners.get(event)?.length ?? 0;
  }

  listeners(event: string): Listener[] {
    return [...(this.#listeners.get(event) ?? [])];
  }

  rawListeners(event: string): Listener[] {
    return this.listeners(event);
  }

  eventNames(): string[] {
    return [...this.#listeners.keys()];
  }

  getMaxListeners(): number {
    return 0;
  }

  setMaxListeners(): this {
    return this;
  }
}

/**
 * Upstream maps `events` to Discord's own Node builtins. Ion maps the one
 * builtin the measured plugins load with to the page-side implementation
 * above; every other id still throws with its reason (see THIRD_PARTY.md).
 */
function eventsModule(): Record<string, unknown> {
  return {
    EventEmitter: PageEventEmitter,
    default: { EventEmitter: PageEventEmitter },
    __esModule: true,
  };
}

/** What a BetterDiscord plugin must expose once constructed. */
export interface BdPluginInstance {
  start(): void;
  stop(): void;
  /** Upstream's deprecated global DOM listener; handed one mutation. */
  observer?(record: MutationRecord): void;
  /** Upstream's deprecated route-change hook. */
  onSwitch?(): void;
  getSettingsPanel?(): unknown;
  icon?: unknown;
}

/** A plugin file's `module.exports`: a class, or a factory function. */
export type BdPluginExport =
  (new (meta: BdAddonMeta) => BdPluginInstance) | ((meta: BdAddonMeta) => BdPluginInstance);

/** Upstream appends this to unwrap ESM-transpiled default exports. */
const NORMALIZE_EXPORTS = `if (module.exports.default) {
    module.exports = module.exports.default;
}`;

// Compiling and running plugin source is the entire point of this file:
// BetterDiscord plugins are plain scripts evaluated in the page.
/* eslint-disable @typescript-eslint/no-implied-eval */
/**
 * The `require` handed to BetterDiscord plugin source.
 *
 * Upstream gives plugins Discord's Node builtins. Ion has no Node in the
 * page, so the default is an honest throw naming the module — but `events`
 * is satisfied page-side (see `eventsModule`), because measured plugins load
 * with it and it grants no capability.
 */
function pluginRequire(id: string): unknown {
  if (id === "events") return eventsModule();
  throw new Error(
    `require(${JSON.stringify(id)}) is not available: BetterDiscord plugins run in Ion's page context without Discord's Node modules`,
  );
}

/**
 * Evaluates one plugin file exactly like upstream: CommonJS-style shim,
 * default-export unwrap, and a sourceURL so stack traces name the file.
 * Throws on compile errors; the caller isolates the failure per plugin.
 */
export function evaluatePluginModule(
  source: string,
  filename: string,
  addonFolder: string,
): unknown {
  const module: { filename: string; exports: unknown } = { filename, exports: {} };
  const body = `${source}\n${NORMALIZE_EXPORTS}\n//# sourceURL=betterdiscord://betterdiscord/plugins/${filename}`;
  const factory = new Function("require", "module", "exports", "__filename", "__dirname", body) as (
    ...args: unknown[]
  ) => void;
  factory(pluginRequire, module, module.exports, filename, addonFolder);
  return module.exports;
}

function isConstructable(
  candidate: BdPluginExport,
): candidate is new (meta: BdAddonMeta) => BdPluginInstance {
  const prototype = (candidate as { prototype?: unknown }).prototype;
  return typeof prototype === "object" && prototype !== null;
}

/**
 * Builds the instance the way upstream does: an export with a prototype is
 * a class (`new`), a prototype-less function is a factory (direct call).
 * Both receive the parsed meta as their only argument.
 */
export function instantiatePlugin(exported: BdPluginExport, meta: BdAddonMeta): BdPluginInstance {
  return isConstructable(exported) ? new exported(meta) : exported(meta);
}
