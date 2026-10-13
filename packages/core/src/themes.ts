/**
 * The theme engine.
 *
 * Adapters own their directories — BetterDiscord's `bd/themes`, Vencord's
 * `vencord/themes`, later the native folder — and everything after "which
 * directory, how do I read one file" belongs here: the store, the documented
 * token set every theme may rely on, the directory sync, and the debounced
 * file watcher that drives hot reload. The store owns registration, persisted
 * enablement, DOM injection, and change notification: one `<style>` element
 * per enabled theme, in registration order, keyed by a `data-ion-theme`
 * attribute so ids stay opaque strings that need no selector escaping.
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
import type { IonTheme, IonThemesApi, ShellFileApi } from "./platform/shell";
import type { SettingsStore } from "./settings";

const ENABLED_KEY_PREFIX = "themes.enabled.";
const STYLE_ATTRIBUTE = "data-ion-theme";
const BASE_STYLE_ATTRIBUTE = "data-ion-theme-base";

const logger = createLogger("themes");

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Where theme styles live: the document's `<head>`, or `<html>` if earlier. */
function styleRoot(): Element {
  // Typed as never absent, but at document-start the parser may not have
  // produced a <head> yet; a query gives the honest runtime answer.
  return document.querySelector("head") ?? document.documentElement;
}

/**
 * The tokens Ion guarantees to theme authors.
 *
 * Discord renames its own custom properties between refreshes (the 2026
 * refresh removed `--background-primary`, `--header-primary` and the
 * `--interactive-*` family outright), so a theme written against them breaks
 * silently. These aliases resolve to whatever Discord ships today — with a
 * literal fallback so a token that disappears degrades to a usable value —
 * and are documented in docs/themes.md, so a theme can rely on them.
 */
export const THEME_BASE_CSS = `
:root {
  --ion-theme-background: var(--background-base-lower, #121214);
  --ion-theme-background-secondary: var(--background-base-low, #17171a);
  --ion-theme-background-tertiary: var(--background-surface-high, #1c1c20);
  --ion-theme-background-raised: var(--background-surface-higher, #17171a);
  --ion-theme-text: var(--text-default, #d4d5d8);
  --ion-theme-text-strong: var(--text-strong, #dcdcdf);
  --ion-theme-text-subtle: var(--text-subtle, #96979e);
  --ion-theme-border: var(--border-subtle, rgba(151, 151, 159, 0.2));
  --ion-theme-accent: var(--brand-500, #5865f2);
  --ion-theme-on-accent: var(--white-500, #ffffff);
  --ion-theme-radius-xs: var(--radius-xs, 4px);
  --ion-theme-radius-sm: var(--radius-sm, 8px);
  --ion-theme-radius-md: var(--radius-md, 12px);
  --ion-theme-radius-lg: var(--radius-lg, 16px);
  --ion-theme-space-1: 4px;
  --ion-theme-space-2: 8px;
  --ion-theme-space-3: 12px;
  --ion-theme-space-4: 16px;
  --ion-theme-font: var(--font-primary, "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif);
  --ion-theme-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
}
`;

/** (Re)installs the base element. Idempotent, and always before themes. */
function installBaseStyle(): void {
  styleRoot().querySelector(`style[${BASE_STYLE_ATTRIBUTE}]`)?.remove();
  const style = document.createElement("style");
  style.setAttribute(BASE_STYLE_ATTRIBUTE, "");
  style.textContent = THEME_BASE_CSS;
  // Appended, never prepended: theme styles land after it in document order,
  // so a theme that sets its own `--ion-theme-*` value overrides ours while
  // still inheriting every token it does not touch.
  styleRoot().appendChild(style);
}

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
  // Every theme store comes with the base tokens: they must exist before any
  // theme style is injected (see THEME_BASE_CSS), and a store is what the
  // bundles have exactly once.
  installBaseStyle();
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

// -- Directory ingestion and hot reload ------------------------------------
//
// Adapters own their directories (BetterDiscord's `bd/themes`, Vencord's
// `vencord/themes`) and the format details of reading one file; everything
// after "which directory, how do I read a file" is identical, so it lives
// here and the first load and a file-change re-read run the same
// reconciliation.

/** What an adapter's reader produces for one file. */
export type ThemeRead =
  { readonly ok: true; readonly theme: IonTheme } | { readonly ok: false; readonly reason: string };

/** One file that could not be registered, and the one-line reason. */
export interface ThemeSkip {
  readonly filename: string;
  readonly reason: string;
}

export interface ThemeDirectoryOptions {
  readonly store: IonThemesApi;
  readonly files: ShellFileApi;
  /** Directory under the Ion data dir, e.g. `bd/themes`. */
  readonly dir: string;
  /** Reads one file of `dir` into a theme, or a reason it is unusable. */
  readonly readTheme: (files: ShellFileApi, filename: string) => Promise<ThemeRead>;
  /**
   * Which files of `dir` are themes at all — BetterDiscord's loader only
   * considers `*.theme.css`, so a stray `README.md` is not even a skip.
   * Defaults to every entry.
   */
  readonly accepts?: ((filename: string) => boolean) | undefined;
  /**
   * Bookkeeping the adapter owns and sync keeps current: the filenames this
   * directory has registered, mapped to the store's theme ids.
   *
   * It has to be per-directory because two adapters may hold files with the
   * same name (`bd/themes/Foo.theme.css` and `vencord/themes/Foo.theme.css`),
   * while `IonTheme.filename` is relative to its own directory.
   */
  readonly registered: Map<string, string>;
}

export type ThemeSyncResult =
  | {
      readonly ok: true;
      readonly loaded: readonly string[];
      readonly skipped: readonly ThemeSkip[];
      readonly removed: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** Whether a re-read would change anything the user can see. */
function sameTheme(before: IonTheme, after: IonTheme): boolean {
  return (
    before.name === after.name &&
    before.description === after.description &&
    before.version === after.version &&
    (before.authors ?? []).join("\u0000") === (after.authors ?? []).join("\u0000") &&
    before.css === after.css
  );
}

/**
 * Reconciles one theme directory with the store: loads what is new, re-reads
 * what changed, unregisters what is gone.
 *
 * The re-read swaps records rather than editing them, which is what keeps a
 * theme's persisted enablement (`themes.enabled.<id>` lives outside the
 * record) across an edit.
 */
export async function syncThemeDirectory(options: ThemeDirectoryOptions): Promise<ThemeSyncResult> {
  const { store, files, dir, readTheme, registered, accepts } = options;

  let listing: readonly string[];
  try {
    // Sorted so load order — and therefore style order — is deterministic.
    listing = (await files.readdir(dir)).sort();
  } catch (error) {
    // Expected on a fresh profile; the adapter decides how to report it.
    return { ok: false, reason: errorText(error) };
  }
  // Entries the directory does not accept are not themes at all —
  // BetterDiscord only reads `*.theme.css`, so a stray README never even
  // counts as a skip. Vencord's directory accepts every stylesheet.
  const entries = accepts === undefined ? listing : listing.filter(accepts);
  const onDisk = new Set(entries);

  const loaded: string[] = [];
  const skipped: ThemeSkip[] = [];
  const removed: string[] = [];

  // Deletions first: a file that was renamed or removed must not keep its
  // id or name in the way of whatever now owns them.
  for (const filename of registered.keys()) {
    if (onDisk.has(filename)) continue;
    const id = registered.get(filename);
    if (id === undefined) continue;
    registered.delete(filename);
    if (store.unregister(id)) removed.push(id);
  }

  for (const filename of entries) {
    const previousId = registered.get(filename);
    const previous = previousId === undefined ? undefined : store.get(previousId);
    let read: ThemeRead;
    try {
      read = await readTheme(files, filename);
    } catch (error) {
      // A reader that throws is a broken file, not a broken loader: the
      // per-file isolation contract the adapters already have.
      skipped.push({ filename, reason: errorText(error) });
      continue;
    }
    if (!read.ok) {
      // An unusable file keeps its running theme: the store is only touched
      // once the new content is known good, so a half-written save cannot
      // strip a user's theme.
      skipped.push({ filename, reason: read.reason });
      continue;
    }
    const { theme } = read;
    // Unchanged re-read: a watcher fires for unrelated saves in the same
    // directory too, and re-registering would reorder styles for nothing.
    if (previous !== undefined && sameTheme(previous, theme)) continue;

    if (previous !== undefined) store.unregister(previous.id);
    try {
      store.register(theme);
      registered.set(filename, theme.id);
      loaded.push(theme.id);
    } catch (error) {
      // A name or id collision with something an adapter did not know
      // about. Put the previous theme back rather than leaving neither.
      if (previous !== undefined) {
        store.register(previous);
        registered.set(filename, previous.id);
      }
      skipped.push({ filename, reason: errorText(error) });
    }
  }

  return { ok: true, loaded, skipped, removed };
}

export interface ThemeWatchOptions {
  readonly files: ShellFileApi;
  /** Directory under the Ion data dir, e.g. `bd/themes`. */
  readonly dir: string;
  /**
   * Re-reads the directory and reconciles the store. Its return value is
   * ignored, so an adapter may hand over its own loader unchanged.
   */
  readonly reconcile: () => unknown;
}

/**
 * Editors write in bursts — one save is several events, a rename is a
 * create plus a delete — so notifications coalesce into one reconciliation
 * and the watcher stays quiet while a user is mid-save.
 */
const WATCH_DEBOUNCE_MS = 150;

/**
 * Subscribes to one theme directory for hot reload.
 *
 * Returns the unsubscribe. Hot reload is an enhancement: a shell that cannot
 * watch leaves the adapter with the load it already did, and says so once.
 */
export function watchThemesDir(options: ThemeWatchOptions): () => void {
  const { files, dir, reconcile } = options;
  let timer: number | undefined;
  let stopped = false;

  const flush = (): void => {
    timer = undefined;
    if (stopped) return;
    void Promise.resolve(reconcile()).catch((error: unknown) => {
      logger.warn(`${dir}: reload after a file change failed — ${errorText(error)}`);
    });
  };

  let unsubscribe: () => void;
  try {
    unsubscribe = files.watch(dir, () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(flush, WATCH_DEBOUNCE_MS);
    });
  } catch (error) {
    logger.warn(`${dir}: hot reload is off — ${errorText(error)}`);
    return () => undefined;
  }

  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
    unsubscribe();
  };
}
