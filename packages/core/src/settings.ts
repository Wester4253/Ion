/**
 * Application settings for Ion and its plugins.
 *
 * One JSON document (`settings/core.json`) in the shell's scoped data
 * directory holds every value; the store keeps them in memory and writes
 * through on a short debounce. Keys are flat and dot-separated: the plugin
 * host owns `plugins.enabled.*`, and every plugin receives a
 * `plugin.<id>.*` namespace through `namespace()`.
 *
 * Boot timing matters: the desktop shell's file bridge is synchronous IPC
 * behind a promise, so `await store.load()` resolves within microtasks —
 * before Discord's first script runs. Plugins therefore register their
 * patches knowing the user's persisted enabled state.
 */

import { createLogger } from "./logging";
import type { ShellFileApi } from "./platform/shell";

const SETTINGS_FILE = "settings/core.json";
const PERSIST_DEBOUNCE_MS = 200;
const FORMAT_VERSION = 1;

const logger = createLogger("settings");

export type SettingsListener = (key: string, value: unknown) => void;

/** The settings surface a plugin receives, scoped to its namespace. */
export interface PluginSettings {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  subscribe(listener: SettingsListener): () => void;
}

export interface SettingsStore {
  /** Read persisted values. Idempotent; concurrent calls share one read. */
  load(): Promise<void>;
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  subscribe(listener: SettingsListener): () => void;
  /** A read/write view of the store scoped under `prefix`. */
  namespace(prefix: string): PluginSettings;
  /** Write pending changes now; resolves when the write chain settles. */
  persistNow(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKey(key: string): void {
  if (key.length === 0 || /\s/.test(key)) {
    throw new TypeError(`settings key must be a non-empty token: ${JSON.stringify(key)}`);
  }
}

function assertSerializable(value: unknown): void {
  if (value === undefined) {
    throw new TypeError("settings values must not be undefined; use delete() instead");
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new TypeError(`settings value is not JSON-serializable: ${typeof value}`);
  }
  try {
    // Round-tripping here rejects circular structures; JSON also silently
    // drops `undefined`/functions inside objects, which is the semantics
    // plugins get when their settings are persisted anyway.
    JSON.stringify(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(`settings value is not JSON-serializable: ${reason}`);
  }
}

export function createSettingsStore(files: ShellFileApi): SettingsStore {
  const values = new Map<string, unknown>();
  const listeners = new Set<SettingsListener>();
  let dirty = false;
  let loading: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes: Promise<void> = Promise.resolve();

  const notify = (key: string, value: unknown): void => {
    for (const listener of listeners) listener(key, value);
  };

  const persistNow = (): Promise<void> => {
    if (!dirty) return writes;
    dirty = false;
    const document = JSON.stringify(
      { version: FORMAT_VERSION, values: Object.fromEntries(values) },
      null,
      2,
    );
    writes = writes
      .then(() => files.writeFile(SETTINGS_FILE, `${document}\n`))
      .catch((error: unknown) => {
        // Keep the values in memory and retry on the next change.
        dirty = true;
        logger.error("failed to persist settings; changes stay in memory", error);
      });
    return writes;
  };

  const schedulePersist = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void persistNow();
    }, PERSIST_DEBOUNCE_MS);
  };

  const store: SettingsStore = {
    load() {
      loading ??= (async () => {
        try {
          if (!(await files.exists(SETTINGS_FILE))) return;
          const raw = await files.readFile(SETTINGS_FILE);
          const parsed: unknown = JSON.parse(raw);
          if (!isRecord(parsed) || !isRecord(parsed["values"])) {
            logger.warn("settings file has an unrecognized shape; starting with defaults");
            return;
          }
          if (parsed["version"] !== FORMAT_VERSION) {
            logger.warn(
              `settings file was written by a different Ion version (${String(parsed["version"])}); loading values anyway`,
            );
          }
          for (const [key, value] of Object.entries(parsed["values"])) values.set(key, value);
        } catch (error) {
          logger.error("settings file unreadable; starting with defaults", error);
        }
      })();
      return loading;
    },

    get<T>(key: string, fallback: T): T {
      const value = values.get(key);
      if (value === undefined) return fallback;
      const expectsPrimitive = typeof fallback !== "object" || fallback === null;
      if (expectsPrimitive && typeof value !== typeof fallback) {
        logger.warn(
          `settings key ${key} held ${typeof value}, expected ${typeof fallback}; using the default`,
        );
        return fallback;
      }
      return value as T;
    },

    set(key, value) {
      assertKey(key);
      assertSerializable(value);
      const previous = values.get(key);
      if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(value)) return;
      values.set(key, value);
      dirty = true;
      notify(key, value);
      schedulePersist();
    },

    delete(key) {
      assertKey(key);
      if (!values.has(key)) return;
      values.delete(key);
      dirty = true;
      notify(key, undefined);
      schedulePersist();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    namespace(prefix) {
      const scoped = `${prefix}.`;
      return {
        get: (key, fallback) => store.get(`${scoped}${key}`, fallback),
        set: (key, value) => {
          store.set(`${scoped}${key}`, value);
        },
        delete: (key) => {
          store.delete(`${scoped}${key}`);
        },
        subscribe: (listener) =>
          store.subscribe((key, value) => {
            if (key.startsWith(scoped)) listener(key.slice(scoped.length), value);
          }),
      };
    },

    persistNow,
  };

  return store;
}
