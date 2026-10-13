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
function unavailableRequire(id: string): never {
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
  factory(unavailableRequire, module, module.exports, filename, addonFolder);
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
