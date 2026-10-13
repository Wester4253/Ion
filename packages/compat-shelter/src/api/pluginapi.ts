/**
 * `shelter.plugin` — the per-plugin half of the API.
 *
 * Upstream's plugin object is `{ store, flushStore, id, manifest,
 * showSettings, scoped }`, built before the plugin's source is evaluated so
 * a plugin can read and seed its store at module scope. Same order here.
 *
 * `store` is a Solid store over whatever `flushStore` last persisted, so a
 * plugin's settings components stay reactive when the plugin writes
 * `store.someFlag = value` directly — which is how the plugins in the wild
 * use it. Persistence goes through the captured DOM storage the core bundle
 * owns rather than `window.localStorage`, because Discord's client deletes
 * that property from the window after load.
 *
 * (uwu/shelter is CC0-1.0; see THIRD_PARTY.md.)
 */

import type { DomStorage } from "@ion/core";
import type { ShelterManifest } from "../manifest";
import type { PluginScope } from "../logger";
import type { ScopedApi, ScopedApiDeps } from "./scoped";
import type { UiSurface } from "./ui";

import { runInPluginScope, shelterLog } from "../logger";
import { createStore, unwrap } from "solid-js/store";
import { createScopedApi } from "./scoped";
import { openSettingsModal } from "./settingsmodal";

/** Profile-storage key for one plugin's persisted store. */
function storageKey(id: string): string {
  return `ion.shelter.plugins.${id}`;
}

/**
 * Reads a plugin's persisted store. A corrupt or non-object value is
 * reported — with the reason — and the plugin starts from an empty store,
 * because dropping a bad file silently would look like data loss with no
 * explanation.
 */
function loadStore(
  storage: DomStorage,
  id: string,
  warn: (message: string) => void,
): Record<string, unknown> {
  const raw = storage.read(storageKey(id));
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warn(`persisted store is not valid JSON (${detail}); starting from an empty store`);
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warn(`persisted store is not a JSON object; starting from an empty store`);
    return {};
  }

  return parsed as Record<string, unknown>;
}

export interface PluginApi {
  readonly store: Record<string, unknown>;
  /** Persists `store`; upstream's `flushStore`, same synchronous contract. */
  flushStore(): void;
  readonly id: string;
  readonly manifest: ShelterManifest;
  showSettings(): void;
  readonly scoped: ScopedApi;
}

export interface PluginApiOptions {
  readonly id: string;
  readonly manifest: ShelterManifest;
  readonly storage: DomStorage;
  readonly deps: ScopedApiDeps;
  readonly ui: UiSurface;
  readonly scope: PluginScope;
  /** The plugin's `settings` component, once its source has been evaluated. */
  readonly getSettings: () => ((props: Record<string, unknown>) => unknown) | undefined;
}

/** Builds the object a plugin sees as `shelter.plugin`. */
export function createPluginApi(options: PluginApiOptions): PluginApi {
  const warn = (message: string): void => {
    runInPluginScope(options.scope, () => {
      shelterLog(message, "warn");
    });
  };

  const initial = loadStore(options.storage, options.id, warn);
  const [store] = createStore<Record<string, unknown>>(initial);
  const scoped = createScopedApi(options.deps, options.scope);

  return {
    store: store,
    flushStore(): void {
      options.storage.write(storageKey(options.id), JSON.stringify(unwrap(store)));
    },
    id: options.id,
    manifest: options.manifest,
    showSettings(): void {
      // Upstream opens a modal titled `Settings - <name>` holding the
      // plugin's `settings` component above a Done button — see
      // `settingsmodal.tsx`, which builds exactly that.
      openSettingsModal(options.ui.openModal, options.manifest.name, options.getSettings());
    },
    scoped,
  };
}
