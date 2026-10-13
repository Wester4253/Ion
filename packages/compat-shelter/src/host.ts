/**
 * Access to the Ion host bundle from the Shelter adapter.
 *
 * The shell evaluates core → ui → compat-vencord → compat-bd →
 * compat-shelter in one script injection, so `window.__ION__` (plugin host,
 * module discovery, DOM storage) is in place before this runs. Adapters must
 * never bundle core a second time — that would duplicate the plugin host and
 * patch registry — so every host capability is reached through an accessor
 * here rather than an import (the `@ion/core` dependency is types-only).
 */

import type { DomStorage, IonDiscoveryApi, IonPluginsApi } from "@ion/core";

function missing(detail: string): Error {
  return new Error(`[ion] compat-shelter requires the Ion core bundle (${detail} is missing)`);
}

/** Module discovery; throws when the core bundle did not run first. */
export function discovery(): IonDiscoveryApi {
  const api = window.__ION__?.discovery;
  if (!api) throw missing("window.__ION__.discovery");
  return api;
}

/** Plugin host; throws when the core bundle did not run first. */
export function pluginsHost(): IonPluginsApi {
  const api = window.__ION__?.plugins;
  if (!api) throw missing("window.__ION__.plugins");
  return api;
}

/**
 * DOM storage for Shelter plugin stores.
 *
 * Deliberately not `window.localStorage`: Discord's client deletes that
 * property from the window after load, while core captured a working
 * reference before Discord's first script ran.
 */
export function domStorage(): DomStorage {
  const api = window.__ION__?.storage;
  if (!api) throw missing("window.__ION__.storage");
  return api;
}
