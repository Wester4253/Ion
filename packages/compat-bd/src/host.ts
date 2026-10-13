/**
 * Access to the Ion host bundle from the BetterDiscord adapter.
 *
 * The shell evaluates core → ui → compat-vencord → compat-bd in one script
 * injection, so `window.__ION__` (plugin host, module discovery, patch
 * telemetry, DOM storage) is in place before this runs. Adapters must never bundle core
 * a second time — that would duplicate the plugin host and patch registry —
 * so every host capability is reached through this accessor instead of an
 * import (the `@ion/core` dependency is types-only).
 */

import type {
  DomStorage,
  IonDiscoveryApi,
  IonPluginsApi,
  IonThemeHostApi,
  IonThemesApi,
} from "@ion/core";

function missing(detail: string): Error {
  return new Error(`[ion] compat-bd requires the Ion core bundle (${detail} is missing)`);
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

/** Theme store; throws when the core bundle did not run first. */
export function themesStore(): IonThemesApi {
  const api = window.__ION__?.themes;
  if (!api) throw missing("window.__ION__.themes");
  return api;
}

/**
 * The shared half of the theme engine (header parsing, directory sync, hot
 * reload). Adapters reach it through the host because they must never bundle
 * core a second time; see `IonThemeHostApi`.
 */
export function themeHost(): IonThemeHostApi {
  const api = window.__ION__?.themeHost;
  if (!api) throw missing("window.__ION__.themeHost");
  return api;
}

/**
 * DOM storage for `BdApi.Data`.
 *
 * Deliberately not `window.localStorage`: Discord's client deletes that property
 * from the window after load, while core captured a working reference before
 * Discord's first script ran. Reads never throw and writes propagate quota
 * failures, which is the behaviour the filesystem-backed upstream store has.
 */
export function domStorage(): DomStorage {
  const api = window.__ION__?.storage;
  if (!api) throw missing("window.__ION__.storage");
  return api;
}
