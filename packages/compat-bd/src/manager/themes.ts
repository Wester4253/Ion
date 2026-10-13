/**
 * BetterDiscord's theme directory, loaded into Ion's theme store.
 *
 * Upstream's ThemeManager reads `themes/*.theme.css` files with the same
 * JSDoc meta header plugins use, and refuses a file without one. Ion keeps
 * the header — parsed by core's shared theme-header parser, which is where
 * BetterDiscord's fallbacks live — and goes further: a `.theme.css` with no
 * header at all is plain CSS, named after its file, and still loads.
 *
 * Everything past "read this one file" is core's `syncThemeDirectory`, so
 * the first load, a targeted reload, and the re-read a file-change
 * notification triggers all behave the same way; `registered` below is the
 * bookkeeping it needs. Per-file isolation is unchanged: one broken theme
 * never blocks another. Enablement defaults to on (recorded as a deviation
 * in THIRD_PARTY.md; BetterDiscord itself defaults new addons to off).
 */

import type { IonTheme, IonThemesApi, ShellFileApi, ThemeRead, ThemeSkip } from "@ion/core";

import { themeHost, themesStore } from "../host";
import { adapterLogger, bdAddonIdFor, errorMessage } from "./pluginmanager";

const THEME_DIR = "bd/themes";
const THEME_EXTENSION = ".theme.css";
/** Upstream's browser-download duplicate (`Foo.theme (1).css`). */
const DUPLICATE_DOWNLOAD = /\.theme\s?\([0-9]+\)\.css/;

/**
 * The filenames this loader has registered, mapped to the store's theme ids.
 * Core keeps it in step with what it registers and unregisters; it cannot be
 * derived from `store.list()`, because another adapter may hold a file with
 * the same name in its own directory.
 */
const registered = new Map<string, string>();

/** Reports every file the loader could not register, one line each. */
function reportSkipped(skipped: readonly ThemeSkip[]): void {
  for (const { filename, reason } of skipped) {
    adapterLogger.warn(`${filename}: skipped — ${reason}`);
  }
}

/** Admission rule: themes plus the browser downloads the reader warns about. */
function isBdThemeFile(filename: string): boolean {
  return filename.endsWith(THEME_EXTENSION) || DUPLICATE_DOWNLOAD.test(filename);
}

/** The one directory pass — first load, reconcile, and reload all use it. */
function directoryPass(store: IonThemesApi, files: ShellFileApi) {
  return {
    store,
    files,
    dir: THEME_DIR,
    readTheme: readBdTheme,
    accepts: isBdThemeFile,
    registered,
  };
}

/**
 * Reads every theme in `bd/themes` into the store. Individual files fail in
 * isolation, so the only rejection paths are a missing core bundle and a
 * missing shell bridge.
 */
export async function loadBdThemes(): Promise<readonly string[]> {
  const store = themesStore();
  const shell = window.ionShell;
  if (!shell) {
    adapterLogger.warn("no shell bridge: the bd/themes directory was not read");
    return [];
  }

  const result = await themeHost().syncDirectory(directoryPass(store, shell.files));
  if (!result.ok) {
    // Expected on a fresh profile: no themes installed yet.
    adapterLogger.log(`no ${THEME_DIR} directory (${result.reason})`);
    return [];
  }
  reportSkipped(result.skipped);
  return result.loaded;
}

/**
 * Reconciles the directory with the store: new files load, changed ones are
 * re-read in place (keeping their persisted enablement), deleted ones are
 * unregistered. This is what a file-change notification runs.
 */
export async function reconcileBdThemes(): Promise<readonly string[]> {
  const files = window.ionShell?.files;
  if (!files) {
    adapterLogger.warn("no shell bridge: the bd/themes directory was not re-read");
    return [];
  }

  const result = await themeHost().syncDirectory(directoryPass(themesStore(), files));
  if (!result.ok) return [];
  reportSkipped(result.skipped);
  return [...result.loaded, ...result.removed];
}

/**
 * Watches `bd/themes` for hot reload. The returned unsubscribe lives as long
 * as the page: an adapter bundle has no teardown point.
 */
export function watchBdThemes(): () => void {
  const files = window.ionShell?.files;
  if (!files) {
    adapterLogger.warn("no shell bridge: bd/themes is not watched for changes");
    return () => undefined;
  }
  return themeHost().watchDirectory({
    files,
    dir: THEME_DIR,
    reconcile: () => reconcileBdThemes(),
  });
}

/**
 * Re-reads one theme file and swaps it into the store, preserving its
 * persisted enablement (the store keeps the key across unregister).
 *
 * Resolves false — keeping the current theme running — when the file can no
 * longer be read or parsed: a bad edit must not strip a user's theme.
 */
export async function reloadBdTheme(idOrNameOrFilename: string): Promise<boolean> {
  const store = themesStore();
  const existing = store.get(idOrNameOrFilename);
  if (!existing) return false;
  const files = window.ionShell?.files;
  if (!files) {
    adapterLogger.warn(`${existing.filename}: reload failed — no shell bridge`);
    return false;
  }

  const fresh = await readBdTheme(files, existing.filename);
  if (!fresh.ok) {
    reportSkipped([{ filename: existing.filename, reason: fresh.reason }]);
    return false;
  }

  store.unregister(existing.id);
  try {
    store.register(fresh.theme);
  } catch (error) {
    // Cannot happen for a name that was unique a moment ago; restore the
    // previous theme rather than leaving the store without either.
    adapterLogger.warn(`${existing.filename}: reload failed — ${errorMessage(error)}`);
    store.register(existing);
    return false;
  }
  registered.set(existing.filename, fresh.theme.id);
  return true;
}

/** Reads and parses one file; the reason it is unusable when it is. */
async function readBdTheme(files: ShellFileApi, filename: string): Promise<ThemeRead> {
  if (DUPLICATE_DOWNLOAD.test(filename)) {
    return {
      ok: false,
      reason: `duplicate download; rename it to ${filename.replace(DUPLICATE_DOWNLOAD, THEME_EXTENSION)}`,
    };
  }

  let source: string;
  try {
    source = await files.readFile(`${THEME_DIR}/${filename}`, "utf8");
  } catch (error) {
    return { ok: false, reason: `unreadable — ${errorMessage(error)}` };
  }

  // A missing header is not an error here: the parser names the theme after
  // its file and reports it as plain CSS.
  const header = themeHost().parseHeader(source, { filename });
  const theme: IonTheme = {
    id: bdAddonIdFor(header.name),
    name: header.name,
    description: header.description,
    authors: [...header.authors],
    version: header.version,
    filename,
    css: source,
  };
  return { ok: true, theme };
}
