/**
 * The theme engine.
 *
 * Adapters read their directories (BetterDiscord's `bd/themes`, later
 * Vencord's `themes` and the native folder) and register what they find
 * here; the store owns everything after that — persisted enablement, DOM
 * injection, and change notification. One `<style>` element per enabled
 * theme, in registration order, keyed by a `data-ion-theme` attribute so
 * ids stay opaque strings that need no selector escaping.
 *
 * Boot timing mirrors the plugin host: `register()` may run before the
 * settings file has been read (adapters start with the bundle, settings
 * load a microtask later), so enablement is applied in `boot()` after
 * `settings.load()`; registrations after that apply immediately. The
 * enablement key is `themes.enabled.<id>` with a default of enabled —
 * installing a theme should show it (BetterDiscord itself defaults new
 * addons to off; that deviation is recorded in THIRD_PARTY.md).
 */

import { createLogger } from "./logging";
import type { IonTheme, IonThemesApi } from "./platform/shell";
import type { SettingsStore } from "./settings";

const ENABLED_KEY_PREFIX = "themes.enabled.";
const STYLE_ATTRIBUTE = "data-ion-theme";

const logger = createLogger("themes");

export interface ThemeStoreOptions {
  readonly settings: SettingsStore;
}

export interface ThemeStore extends IonThemesApi {
  /** Apply persisted enablement to everything registered so far. */
  boot(): void;
}

function assertId(value: string): void {
  if (value.length === 0 || /\s/.test(value)) {
    throw new TypeError(`theme id must be a non-empty token: ${JSON.stringify(value)}`);
  }
}

function assertName(value: string): void {
  if (value.trim().length === 0) {
    throw new TypeError("theme name must be a non-empty string");
  }
}

export function createThemeStore(options: ThemeStoreOptions): ThemeStore {
  const { settings } = options;
  const records = new Map<string, IonTheme>();
  const listeners = new Set<() => void>();
  let booted = false;

  const readEnabled = (id: string): boolean => settings.get(`${ENABLED_KEY_PREFIX}${id}`, true);

  const resolve = (idOrNameOrFilename: string): IonTheme | undefined => {
    const direct = records.get(idOrNameOrFilename);
    if (direct) return direct;
    for (const theme of records.values()) {
      if (theme.name === idOrNameOrFilename || theme.filename === idOrNameOrFilename) {
        return theme;
      }
    }
    return undefined;
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const styleRoot = (): Element =>
    // Typed as never absent, but at document-start the parser may not have
    // produced a <head> yet; a query gives the honest runtime answer.
    document.querySelector("head") ?? document.documentElement;

  const findStyle = (id: string): Element | undefined => {
    for (const element of styleRoot().querySelectorAll("style")) {
      if (element.getAttribute(STYLE_ATTRIBUTE) === id) return element;
    }
    return undefined;
  };

  const removeStyle = (id: string): void => {
    findStyle(id)?.remove();
  };

  const injectStyle = (theme: IonTheme): void => {
    removeStyle(theme.id);
    const style = document.createElement("style");
    style.setAttribute(STYLE_ATTRIBUTE, theme.id);
    style.textContent = theme.css;
    styleRoot().appendChild(style);
  };

  const applyEnabled = (theme: IonTheme): void => {
    if (readEnabled(theme.id)) injectStyle(theme);
    else removeStyle(theme.id);
  };

  return {
    register(theme) {
      assertId(theme.id);
      assertName(theme.name);
      if (records.has(theme.id)) {
        throw new Error(`theme id already registered: ${theme.id}`);
      }
      for (const existing of records.values()) {
        if (existing.name === theme.name) {
          throw new Error(`theme name already registered: ${theme.name}`);
        }
      }
      records.set(theme.id, theme);
      if (booted) applyEnabled(theme);
      notify();
    },

    unregister(idOrNameOrFilename) {
      const theme = resolve(idOrNameOrFilename);
      if (!theme) return false;
      records.delete(theme.id);
      removeStyle(theme.id);
      notify();
      return true;
    },

    get(idOrNameOrFilename) {
      return resolve(idOrNameOrFilename);
    },

    list() {
      return [...records.values()].map((theme) => ({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        authors: theme.authors ?? [],
        version: theme.version,
        filename: theme.filename,
        enabled: readEnabled(theme.id),
      }));
    },

    isEnabled(idOrNameOrFilename) {
      const theme = resolve(idOrNameOrFilename);
      if (!theme) return false;
      return readEnabled(theme.id);
    },

    setEnabled(idOrNameOrFilename, enabled) {
      const theme = resolve(idOrNameOrFilename);
      if (!theme) {
        logger.warn(`unknown theme: ${JSON.stringify(idOrNameOrFilename)}`);
        return false;
      }
      if (readEnabled(theme.id) !== enabled) {
        settings.set(`${ENABLED_KEY_PREFIX}${theme.id}`, enabled);
        if (booted) applyEnabled(theme);
        notify();
      }
      return true;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    boot() {
      if (booted) return;
      booted = true;
      for (const theme of records.values()) applyEnabled(theme);
      notify();
    },
  };
}
