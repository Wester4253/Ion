/**
 * Vencord's theme directory, loaded into Ion's theme store.
 *
 * Upstream keeps user themes in `vencord/themes`, lists them through
 * `VencordNative.themes.getThemesList()`, and reads the CSS through
 * `getThemeData()` — all of which are filesystem calls into a directory the
 * renderer may not touch. Ion has a scoped file bridge instead, so this
 * module is both halves: it loads the directory into Ion's own theme store
 * (through core's shared engine, reached on the host global because adapters
 * never bundle core) and it answers the vendored API's questions from the
 * same files.
 *
 * Deviations from upstream, all deliberate:
 * - the header falls back the way BetterDiscord's does (shared parser), so a
 *   theme with no block at all still loads, named after its file;
 * - only `*.css` files are considered themes, where upstream lists whatever
 *   the folder happens to contain;
 * - deleting a file has no bridge primitive yet, so `deleteTheme` says so
 *   instead of silently doing nothing.
 *
 * Console output is this module's only logging channel: importing the
 * vendored `@utils/Logger` would pull upstream's compile-time flags and
 * aliases into anything that imports this file, including its tests.
 */

/* eslint-disable no-console -- this adapter's one console chokepoint for
   theme loading, where the vendored Logger cannot be imported (see the
   module header). */

import type {
  IonTheme,
  IonThemeHostApi,
  IonThemesApi,
  ShellFileApi,
  ThemeDirectoryOptions,
  ThemeRead,
  ThemeSkip,
} from "@ion/core";

/** A theme as Vencord's settings UI reads it (upstream's `UserThemeHeader`). */
export interface VencordUserThemeHeader {
  readonly fileName: string;
  readonly name: string;
  readonly author: string;
  readonly description: string;
  readonly version?: string | undefined;
}

/** A single path segment ending in `.css`: the only shape `uploadTheme` takes. */
const THEME_FILE_NAME = /^[^\s/\\]+\.css$/i;

/** The one directory this module owns, under Ion's scoped data dir. */
const THEME_DIR = "vencord/themes";

/** The id an addon occupies: `vc.<name>`, whitespace replaced by `_`. */
function vcAddonIdFor(name: string): string {
  return `vc.${name.replace(/\s+/g, "_")}`;
}

/** The shared theme engine; throws when the core bundle did not run first. */
function themeHost(): IonThemeHostApi {
  const api = window.__ION__?.themeHost;
  if (!api) {
    throw new Error(
      "[ion] compat-vencord requires the Ion core bundle (window.__ION__.themeHost is missing)",
    );
  }
  return api;
}

/** The Ion theme store every adapter registers with. */
function themesStore(): IonThemesApi {
  const api = window.__ION__?.themes;
  if (!api) {
    throw new Error(
      "[ion] compat-vencord requires the Ion core bundle (window.__ION__.themes is missing)",
    );
  }
  return api;
}

/**
 * The filenames this loader has registered, mapped to the store's theme ids;
 * core's directory sync keeps it in step (see `ThemeDirectoryOptions`).
 */
const registered = new Map<string, string>();

/** The pieces of a directory pass the callers supply; the rest is fixed. */
interface DirectoryPassOptions {
  readonly store: IonThemesApi;
  readonly files: ShellFileApi;
  readonly registered: Map<string, string>;
}

/** Reports every file the loader could not register, one line each. */
function reportSkipped(skipped: readonly ThemeSkip[]): void {
  for (const { filename, reason } of skipped) {
    console.warn(`[compat-vencord] ${filename}: skipped — ${reason}`);
  }
}

function directoryPass({ store, files, registered }: DirectoryPassOptions): ThemeDirectoryOptions {
  return {
    store,
    files,
    dir: THEME_DIR,
    readTheme: readVencordTheme,
    // Upstream lists everything in the folder; Ion only takes stylesheets,
    // so a stray README or editor backup is not registered as a theme.
    accepts: (filename) => filename.toLowerCase().endsWith(".css"),
    registered,
  };
}

/**
 * Reads every theme in `vencord/themes` into the store. Individual files
 * fail in isolation; the only rejection paths are a missing core bundle and
 * a missing shell bridge.
 */
export async function loadVencordThemes(): Promise<readonly string[]> {
  const files = window.ionShell?.files;
  if (!files) {
    console.warn("[compat-vencord] no shell bridge: the vencord/themes directory was not read");
    return [];
  }

  const result = await themeHost().syncDirectory(
    directoryPass({ store: themesStore(), files, registered }),
  );
  if (!result.ok) {
    console.log(`[compat-vencord] no ${THEME_DIR} directory (${result.reason})`);
    return [];
  }
  reportSkipped(result.skipped);
  return result.loaded;
}

/**
 * Reconciles the directory with the store — what a file-change notification
 * runs, and what `VencordNative.themes.uploadTheme` relies on to make an
 * uploaded theme appear.
 */
export async function reconcileVencordThemes(): Promise<readonly string[]> {
  const files = window.ionShell?.files;
  if (!files) {
    console.warn("[compat-vencord] no shell bridge: the vencord/themes directory was not re-read");
    return [];
  }

  const result = await themeHost().syncDirectory(
    directoryPass({ store: themesStore(), files, registered }),
  );
  if (!result.ok) return [];
  reportSkipped(result.skipped);
  return [...result.loaded, ...result.removed];
}

/**
 * Watches `vencord/themes` for hot reload. The returned unsubscribe lives as
 * long as the page: an adapter bundle has no teardown point.
 */
export function watchVencordThemes(): () => void {
  const files = window.ionShell?.files;
  if (!files) {
    console.warn("[compat-vencord] no shell bridge: vencord/themes is not watched for changes");
    return () => undefined;
  }
  return themeHost().watchDirectory({
    files,
    dir: THEME_DIR,
    reconcile: () => reconcileVencordThemes(),
  });
}

/**
 * Re-reads one theme file and swaps it into the store, preserving its
 * persisted enablement. Resolves false when the file can no longer be read
 * or parsed: a bad edit must not strip a user's theme.
 */
export async function reloadVencordTheme(idOrNameOrFilename: string): Promise<boolean> {
  const store = themesStore();
  const existing = store.get(idOrNameOrFilename);
  if (!existing) return false;
  const files = window.ionShell?.files;
  if (!files) {
    console.warn(`[compat-vencord] ${existing.filename}: reload failed — no shell bridge`);
    return false;
  }

  const fresh = await readVencordTheme(files, existing.filename);
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
    console.warn(
      `[compat-vencord] ${existing.filename}: reload failed — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    store.register(existing);
    return false;
  }
  registered.set(existing.filename, fresh.theme.id);
  return true;
}

/** Reads and parses one file; the reason it is unusable when it is. */
async function readVencordTheme(files: ShellFileApi, filename: string): Promise<ThemeRead> {
  let source: string;
  try {
    source = await files.readFile(`${THEME_DIR}/${filename}`, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `unreadable — ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // A missing header is not an error here: the parser names the theme after
  // its file and reports it as plain CSS.
  const header = themeHost().parseHeader(source, { filename });
  const theme: IonTheme = {
    id: vcAddonIdFor(header.name),
    name: header.name,
    description: header.description,
    authors: [...header.authors],
    version: header.version,
    filename,
    css: source,
  };
  return { ok: true, theme };
}

/** Upstream's `VencordNative.themes.getThemesList`. */
export async function listVencordThemes(): Promise<readonly VencordUserThemeHeader[]> {
  const files = window.ionShell?.files;
  if (!files) return [];

  let entries: readonly string[];
  try {
    entries = (await files.readdir(THEME_DIR)).sort();
  } catch {
    // Expected on a fresh profile: no themes installed yet.
    return [];
  }

  const themes: VencordUserThemeHeader[] = [];
  for (const filename of entries) {
    if (!THEME_FILE_NAME.test(filename)) continue;
    const theme = await listEntry(files, filename);
    if (theme) themes.push(theme);
  }
  return themes;
}

/** One row of the list: identity from the header, or from the file name. */
async function listEntry(
  files: ShellFileApi,
  filename: string,
): Promise<VencordUserThemeHeader | undefined> {
  let source: string;
  try {
    source = await files.readFile(`${THEME_DIR}/${filename}`, "utf8");
  } catch (error) {
    console.warn(
      `[compat-vencord] ${filename}: unreadable — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }

  const header = themeHost().parseHeader(source, { filename });
  return {
    fileName: filename,
    name: header.name,
    // Upstream's header carries one author string, so a file with several
    // `@author` lines joins them rather than dropping all but one. A file
    // with none at all falls back to upstream's placeholder here — the store
    // keeps the honest empty list instead.
    author: header.authors.length > 0 ? header.authors.join(", ") : "Unknown Author",
    description: header.description,
    version: header.version,
  };
}

/** Upstream's `VencordNative.themes.getThemeData`: the file's CSS. */
export async function readVencordThemeData(fileName: string): Promise<string> {
  const files = window.ionShell?.files;
  if (!files) throw new Error("[compat-vencord] no shell bridge to read theme data");
  return files.readFile(`${THEME_DIR}/${fileName}`, "utf8");
}

/** Upstream's `VencordNative.themes.uploadTheme`: write the file, let the
 *  watcher register it. */
export async function writeVencordTheme(fileName: string, data: string): Promise<void> {
  const files = window.ionShell?.files;
  if (!files) throw new Error("[compat-vencord] no shell bridge to upload a theme");
  if (!THEME_FILE_NAME.test(fileName) || fileName.includes("..")) {
    throw new Error(`[compat-vencord] refused theme file name: ${JSON.stringify(fileName)}`);
  }
  await files.writeFile(`${THEME_DIR}/${fileName}`, data, "utf8");
}

/**
 * Upstream's `VencordNative.themes.deleteTheme`. Ion's file bridge has no
 * delete, so this refuses with the exact step the user has to take instead
 * of pretending the file is gone.
 */
export function deleteVencordTheme(fileName: string): Promise<never> {
  return Promise.reject(
    new Error(
      `[compat-vencord] Ion cannot delete ${THEME_DIR}/${fileName}: remove the file in your file manager (Ion's file bridge has no delete)`,
    ),
  );
}

/**
 * Upstream's `VencordNative.themes.openFolder`. Void upstream, so there is
 * no result to reject with; the page also cannot name the directory, because
 * the bridge only exposes paths relative to Ion's private data dir.
 */
export function openVencordThemesFolder(): void {
  throw new Error(
    `[compat-vencord] Ion cannot open ${THEME_DIR}: the themes folder lives in Ion's private data directory, and a page may not open folders on your system`,
  );
}
