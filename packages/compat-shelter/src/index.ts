/**
 * compat-shelter entry — the Shelter adapter.
 *
 * Built as a plain IIFE (see package.json's `ion.bundles`): evaluating this
 * bundle installs `window.shelter`, the global every Shelter plugin's source
 * resolves its `shelter` reference against, and starts the staged plugins
 * through the Ion host.
 *
 * The shell evaluates it after core, ui, and the other adapters in one
 * injection (shell-desktop/src/main/bundle.ts), so `window.__ION__` — the
 * plugin host, module discovery, and the captured DOM storage — is already
 * in place when this runs.
 */

import type { ShelterApiSurface } from "./api";

import { shelterApi } from "./api";
import { discovery, domStorage, pluginsHost } from "./host";
import { adapterLog, errorMessage } from "./logger";
import { ShelterPluginManager } from "./manager";

declare global {
  interface Window {
    /** Installed by this bundle; Shelter plugins read it as a global. */
    shelter?: ShelterApiSurface;
  }
}

const storage = domStorage();

const manager = new ShelterPluginManager({
  host: pluginsHost(),
  storage,
  shell: window.ionShell,
  api: () => apiPromise,
});

// One build shared by every caller: `window.shelter` is installed from it as
// soon as it resolves, and the manager awaits the same promise before it
// evaluates any plugin, so a plugin never reads a half-built API.
const apiPromise: Promise<ShelterApiSurface> = shelterApi({
  discovery: discovery(),
  storage,
  plugins: manager.bridge,
});

void apiPromise
  .then((surface) => {
    Object.defineProperty(window, "shelter", {
      value: surface,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  })
  .catch((error: unknown) => {
    adapterLog("error", "the window.shelter API could not be built", errorMessage(error));
  });

// Registration itself cannot fail per plugin: a directory that cannot be
// read or a manifest that is not valid JSON becomes a plugin that fails at
// start with that reason, so it still shows up on the scoreboard. This
// rejection means the host or the shell bridge is missing — a broken
// injection order — reported once rather than once per plugin.
void manager.initialize().catch((error: unknown) => {
  adapterLog("error", "Shelter plugin loading aborted", errorMessage(error));
});
