/**
 * DOM storage, captured before the page can take it away.
 *
 * Discord's web client deletes `window.localStorage` and `window.sessionStorage`
 * from the window shortly after its own scripts run, while it keeps using
 * references it captured first. Anything that reaches for `window.localStorage`
 * lazily — which is every plugin ecosystem written against a normal browser —
 * therefore finds `undefined`: BetterDiscord's `BdApi.Data` throws on every
 * write (its reads were already degrading to empty data), and Vencord's
 * settings silently fall back to defaults.
 *
 * The shell injects core before Discord's first script, so this module
 * evaluates in the one window where the properties still exist and holds the
 * reference for the life of the page. Adapters must go through
 * `window.__ION__.storage` rather than touching `window.localStorage`
 * themselves, both because it is already captured and because bundling this
 * module a second time would capture a reference the page has since removed.
 *
 * Reads never throw — an unreadable key reads as absent, which is how the
 * foreign formats treat missing data. Writes let quota and serialization
 * failures propagate, matching the filesystem-backed stores upstream writes
 * against. When no storage area survives the capture, both directions run
 * against a volatile map so plugins keep working, and the single warning below
 * states plainly that the data is lost on reload.
 */

import { createLogger } from "./logging";

/** Which backing store the capture found, in the order it was tried. */
export type DomStorageBackend = "localStorage" | "sessionStorage" | "memory";

/** Synchronous key/value persistence for bundled and foreign plugins. */
export interface DomStorage {
  /** What reads and writes are running against right now. */
  readonly backend: DomStorageBackend;
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

const logger = createLogger("storage");

/** The window properties the capture tries, in preference order. */
const AREA_NAMES = ["localStorage", "sessionStorage"] as const;

type AreaName = (typeof AREA_NAMES)[number];

/** Written and removed once per candidate to prove the area is usable. */
const PROBE_KEY = "ion.storage.probe";
const PROBE_VALUE = "ok";

/**
 * Returns the area when it can be read and written, else null. Storage access
 * throws a SecurityError in contexts that block it, and private-mode areas
 * accept nothing at all, so both are probed rather than assumed.
 */
function usableArea(name: AreaName): Storage | null {
  try {
    const area = window[name];
    area.setItem(PROBE_KEY, PROBE_VALUE);
    if (area.getItem(PROBE_KEY) !== PROBE_VALUE) return null;
    area.removeItem(PROBE_KEY);
    return area;
  } catch {
    return null;
  }
}

function capture(): { area: Storage | null; backend: DomStorageBackend } {
  for (const name of AREA_NAMES) {
    const area = usableArea(name);
    if (area !== null) return { area, backend: name };
  }
  return { area: null, backend: "memory" };
}

const { area, backend } = capture();

/** Holds values only while `backend === "memory"`; never read otherwise. */
const volatile = new Map<string, string>();

if (backend === "memory") {
  logger.warn(
    "no DOM storage area survived the capture — plugin data and settings are kept in memory only and are lost on reload",
  );
}

export const domStorage: DomStorage = {
  backend,
  read(key) {
    if (area === null) return volatile.get(key) ?? null;
    try {
      return area.getItem(key);
    } catch {
      // An area that stops responding reads as having no value, matching the
      // "missing data" behaviour every caller already handles.
      return null;
    }
  },
  write(key, value) {
    if (area === null) {
      volatile.set(key, value);
      return;
    }
    area.setItem(key, value);
  },
  remove(key) {
    if (area === null) {
      volatile.delete(key);
      return;
    }
    area.removeItem(key);
  },
};
