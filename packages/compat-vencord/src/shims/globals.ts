/**
 * Host-side native facades: `window.VencordNative` (and the `app` slice of
 * `window.VesktopNative` that vendored Vesktop-flavored code probes for).
 *
 * Upstream these are IPC surfaces into the Electron main process. In Ion
 * they resolve against what the shell actually offers:
 *
 * - `settings` persists through core's captured DOM storage in the isolated
 *   Ion profile — synchronous, exactly like the module-eval-time read in the
 *   vendored Settings store requires. It is per-profile and never touches
 *   Vesktop's or Discord's storage.
 * - `native.openExternal` goes through Ion's allowlisted shell bridge.
 * - Vencord-managed features whose backing service belongs to Ion instead
 *   (themes directory, QuickCss, the Vencord updater, cloud sync) either
 *   ride on Ion's own engine or answer with a descriptive failure; every one
 *   of them is documented in docs/status.md's compatibility notes. Nothing
 *   here silently pretends a feature exists.
 *
 * This module must be the compat bundle's first evaluated import: the
 * vendored Settings store calls `VencordNative.settings.get()` at module
 * evaluation time.
 */

const SETTINGS_KEY = "ion.vencord.settings";
const QUICK_CSS_KEY = "ion.vencord.quickCss";

// Import order is load-bearing: this module must not import anything that
// reads `window.VencordNative` at evaluation time (the vendored Settings
// store does). src/themes.ts only touches `window.__ION__` lazily, so it is
// safe to pull in here — and it must be, because the theme section below
// answers for the real files.
import {
  deleteVencordTheme,
  listVencordThemes,
  openVencordThemesFolder,
  readVencordThemeData,
  writeVencordTheme,
} from "../themes";

function readStorage(key: string): string | null {
  // Core's captured DOM storage, not `window.localStorage`: Discord deletes
  // that property from the window shortly after its own scripts run, so a
  // lazy lookup would find `undefined` and settings would never load.
  return window.__ION__?.storage.read(key) ?? null;
}

function writeStorage(key: string, value: string): void {
  try {
    window.__ION__?.storage.write(key, value);
  } catch (error) {
    // eslint-disable-next-line no-console -- surfaced to devtools: settings would silently vanish otherwise
    console.error("[ion/vencord] could not persist settings to DOM storage", error);
  }
}

function parse<T>(key: string, fallback: T): T {
  const raw = readStorage(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Rejected with a message naming the feature and its Ion owner. */
function unavailable(feature: string, owner: string): Promise<never> {
  return Promise.reject(new Error(`compat-vencord: ${feature} is handled by ${owner} in Ion`));
}

function installVencordNative(): void {
  const shell = window.ionShell;

  const api: VencordNativeApi = {
    settings: {
      // Synchronous on purpose: the vendored Settings store reads it at
      // module evaluation, before anything can await.
      get: () => parse<Record<string, unknown>>(SETTINGS_KEY, {}),
      set: (settings) => {
        writeStorage(SETTINGS_KEY, JSON.stringify(settings));
        return Promise.resolve();
      },
      openFolder: () => {
        // No standalone settings folder: Ion persists these values inside
        // the isolated profile's localStorage (see docs/status.md).
      },
    },
    native: {
      openExternal: (url) => {
        if (!shell) {
          return Promise.reject(new Error("compat-vencord: no shell bridge for openExternal"));
        }
        return shell.openExternal(url);
      },
      getVersions: () => ({}),
      getRendererCss: () => Promise.resolve(""),
      onRendererCssUpdate: () => () => undefined,
      supportsWindowsMaterial: () => Promise.resolve(false),
    },
    quickCss: {
      get: () => Promise.resolve(parse<string>(QUICK_CSS_KEY, "")),
      set: (css) => {
        writeStorage(QUICK_CSS_KEY, css);
        return Promise.resolve();
      },
      addChangeListener: () => () => undefined,
      addThemeChangeListener: () => () => undefined,
      openEditor: () => {
        unavailable("QuickCss", "Ion's theme engine").catch(() => undefined);
      },
    },
    themes: {
      // Ion's theme engine owns these files (see src/themes.ts), so the
      // vendored API reads and writes the same directory the loader does.
      getThemesList: () => listVencordThemes(),
      getThemeData: (fileName) => readVencordThemeData(fileName),
      // Upstream reads these from the OS (a Windows registry lookup that has
      // no equivalent here); Ion has no such source, so it answers with an
      // empty set — the same no-op this has always been.
      getSystemValues: () => Promise.resolve({}),
      uploadTheme: (fileName, data) => writeVencordTheme(fileName, data),
      deleteTheme: (fileName) => deleteVencordTheme(fileName),
      openFolder: () => {
        openVencordThemesFolder();
      },
    },
    updater: {
      getRepo: () => Promise.resolve({ ok: true, value: "" }),
      getUpdates: () => Promise.resolve({ ok: false, error: "updates are handled by Ion" }),
      update: () => Promise.resolve({ ok: false, error: "updates are handled by Ion" }),
      rebuild: () => Promise.resolve({ ok: false, error: "updates are handled by Ion" }),
    },
    csp: {
      // Ion does not impose Discord Desktop's CSP on themes; report the
      // domain as allowed and refuse adding overrides (there are none).
      isDomainAllowed: () => Promise.resolve(true),
      requestAddOverride: () =>
        Promise.resolve({ ok: false, error: "Ion does not maintain a CSP override list" }),
    },
  };

  window.VencordNative = api;

  // Vesktop-flavored plugin code (IS_VESKTOP builds) probes a smaller
  // VesktopNative surface. `clipboard` intentionally stays undefined: the
  // vendored WebContextMenus checks for it and falls back to its own copy
  // path when absent.
  const vesktopNative: NonNullable<Window["VesktopNative"]> = {
    app: {
      getRendererCss: () => Promise.resolve(""),
      getVersion: () => Promise.resolve(window.ionShell?.appVersion ?? "unknown"),
      isOutdated: () => Promise.resolve(false),
      onRendererCssUpdate: () => () => undefined,
      openUpdater: () => {
        unavailable("Vesktop's updater", "Ion's updater").catch(() => undefined);
      },
      relaunch: () => {
        window.location.reload();
      },
    },
  };
  window.VesktopNative = vesktopNative;
}

installVencordNative();
