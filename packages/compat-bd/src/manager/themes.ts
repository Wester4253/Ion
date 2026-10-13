/**
 * BetterDiscord's theme directory, loaded into Ion's theme store.
 *
 * Upstream's ThemeManager reads `themes/*.theme.css` files with the same
 * JSDoc meta header plugins use; here `window.__ION__.themes` owns
 * injection, persistence, and enablement, so this file only reads,
 * registers, and re-reads — isolated per file like the plugin loader: one
 * broken theme never blocks another. Enablement defaults to on (recorded
 * as a deviation in THIRD_PARTY.md; BetterDiscord itself defaults new
 * addons to off).
 */

import type { IonTheme, ShellFileApi } from "@ion/core";

import { themesStore } from "../host";
import { readAddonMeta } from "./meta";
import { adapterLogger, bdAddonIdFor, errorMessage } from "./pluginmanager";

const THEME_DIR = "bd/themes";
const THEME_EXTENSION = ".theme.css";
/** Upstream's browser-download duplicate (`Foo.theme (1).css`). */
const DUPLICATE_DOWNLOAD = /\.theme\s?\([0-9]+\)\.css/;

/**
 * Reads every theme in `bd/themes` into the store. Individual files fail
 * in isolation, so the only rejection path is a missing plugin store.
 */
export async function loadBdThemes(): Promise<readonly string[]> {
  const store = themesStore();
  const shell = window.ionShell;
  if (!shell) {
    adapterLogger.warn("no shell bridge: the bd/themes directory was not read");
    return [];
  }

  let entries: readonly string[];
  try {
    // Sorted so load order (and therefore style order) is deterministic.
    entries = (await shell.files.readdir(THEME_DIR)).sort();
  } catch (error) {
    // Expected on a fresh profile: no themes installed yet.
    adapterLogger.log(`no ${THEME_DIR} directory (${errorMessage(error)})`);
    return [];
  }

  const loaded: string[] = [];
  for (const filename of entries) {
    if (DUPLICATE_DOWNLOAD.test(filename)) {
      adapterLogger.warn(
        `${filename}: skipped — duplicate download; rename it to ${filename.replace(DUPLICATE_DOWNLOAD, THEME_EXTENSION)}`,
      );
      continue;
    }
    if (!filename.endsWith(THEME_EXTENSION)) continue;
    const theme = await readBdTheme(shell.files, filename);
    if (!theme) continue;
    try {
      store.register(theme);
      loaded.push(theme.id);
    } catch (error) {
      adapterLogger.warn(`${filename}: skipped — ${errorMessage(error)}`);
    }
  }
  return loaded;
}

/**
 * Re-reads one theme file and swaps it into the store, preserving its
 * persisted enablement (the store keeps the key across unregister).
 *
 * Resolves false — keeping the current theme running — when the file can
 * no longer be read or parsed: a bad edit must not strip a user's theme.
 */
export async function reloadBdTheme(idOrNameOrFilename: string): Promise<boolean> {
  const store = themesStore();
  const existing = store.get(idOrNameOrFilename);
  if (!existing) return false;
  const shell = window.ionShell;
  if (!shell) {
    adapterLogger.warn(`${existing.filename}: reload failed — no shell bridge`);
    return false;
  }

  const fresh = await readBdTheme(shell.files, existing.filename);
  if (!fresh) return false;

  store.unregister(existing.id);
  try {
    store.register(fresh);
  } catch (error) {
    // Cannot happen for a name that was unique a moment ago; restore the
    // previous theme rather than leaving the store without either.
    adapterLogger.warn(`${existing.filename}: reload failed — ${errorMessage(error)}`);
    store.register(existing);
    return false;
  }
  return true;
}

/** Reads and parses one file; undefined (plus a one-line reason) when unusable. */
async function readBdTheme(files: ShellFileApi, filename: string): Promise<IonTheme | undefined> {
  let source: string;
  try {
    source = await files.readFile(`${THEME_DIR}/${filename}`, "utf8");
  } catch (error) {
    adapterLogger.warn(`${filename}: unreadable — ${errorMessage(error)}`);
    return undefined;
  }

  const read = readAddonMeta(filename, source);
  if (!read.ok) {
    adapterLogger.warn(`${filename}: skipped — ${read.reason}`);
    return undefined;
  }
  const { meta } = read;
  return {
    id: bdAddonIdFor(meta.name),
    name: meta.name,
    description: meta.description,
    authors: [meta.author],
    version: meta.version,
    filename,
    css: source,
  };
}
