/**
 * compat-vencord entry — the adapter's mirror of upstream's `src/Vencord.ts`,
 * minus everything Ion owns natively (updater, cloud sync, and the
 * main-process services behind VencordNative — see src/shims/globals.ts).
 *
 * Built as an IIFE with globalName `Vencord` (see scripts/build.mjs), so the
 * exports below become `window.Vencord`, exactly like upstream's renderer
 * build. The shell evaluates the bundle after core and ui in a single
 * injection (shell-desktop/src/main/bundle.ts).
 *
 * Import order is load-bearing:
 *   1. src/shims/globals — installs window.VencordNative before any vendored
 *      module evaluates (the Settings store reads it at module-eval time),
 *   2. ~plugins — evaluates the 32 plugin definitions and builds the
 *      name→definition registry, which Settings' defaults and translation
 *      both consume.
 * Everything after that is plain assembly: the upstream global namespace,
 * then registration with the Ion plugin host, whose stages then drive each
 * plugin's start (translated from upstream's startAt).
 */

import "./shims/globals";

import { PlainSettings, Settings } from "@api/Settings";
import { initStyles } from "@api/Styles";
import { Logger } from "@utils/Logger";
import * as Common from "@webpack/common";
import plugins from "~plugins";

import * as WebpackShim from "./shims/webpack";
import { translatePlugin } from "./translate";

export * as Api from "@api";
export * as Plugins from "@api/PluginManager";
export * as Components from "@components";
export * as Updater from "@utils/updater";
export * as Util from "@utils";
export * as WebpackPatcher from "./shims/patcher";
export { PlainSettings, Settings };
/** Upstream's `Webpack` export: the facade plus Discord's common modules. */
export const Webpack = { ...WebpackShim, Common };

const logger = new Logger("CompatVencord");

/**
 * Translate the 32 acceptance definitions into Ion plugin manifests and hand
 * them to the host. Translation failures isolate to the single plugin: the
 * rest of the set still registers, and the failure is logged by name.
 */
function registerAcceptancePlugins(): void {
  const host = window.__ION__?.plugins;
  if (!host) {
    throw new Error("compat-vencord loaded before the Ion core: window.__ION__.plugins missing");
  }

  const availablePlugins = new Set(Object.keys(plugins));
  for (const definition of Object.values(plugins)) {
    try {
      host.register(translatePlugin(definition, { availablePlugins }));
    } catch (error) {
      logger.error(`could not translate plugin ${definition.name}`, error);
    }
  }
}

// Upstream runs initStyles before starting plugins; the vendored styles are
// collected during module evaluation above, so this just builds the style
// root and wires the (shimmed) renderer CSS.
initStyles();
registerAcceptancePlugins();
