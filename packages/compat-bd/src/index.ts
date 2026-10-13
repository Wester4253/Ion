/**
 * compat-bd entry — the BetterDiscord adapter.
 *
 * Built as a plain IIFE (see package.json's `ion.bundles`; the generic
 * bundler has no globalName option, so the entry installs its own global):
 * evaluating this bundle installs `window.BdApi`, the surface every
 * BetterDiscord plugin imports, before any plugin code runs.
 *
 * The shell evaluates it after core and ui in one injection
 * (shell-desktop/src/main/bundle.ts), so `window.__ION__` — the plugin host
 * and module discovery — is already in place when this runs.
 */

import { BdApi } from "./api";
import { adapterLogger, pluginManager } from "./manager/pluginmanager";

declare global {
  interface Window {
    /** Installed by this bundle; BetterDiscord plugins read it as a global. */
    BdApi?: typeof BdApi;
  }
}

Object.defineProperty(window, "BdApi", {
  value: BdApi,
  writable: true,
  configurable: true,
  enumerable: true,
});

// User-installed BetterDiscord plugins are evaluated once the host is in
// place. This rejects only when the host itself is missing (a broken
// injection order), so the adapter-wide failure is reported once rather
// than per plugin; individual files fail in isolation inside.
void pluginManager.initialize().catch((error: unknown) => {
  adapterLogger.error("BetterDiscord plugin loading aborted", error);
});
