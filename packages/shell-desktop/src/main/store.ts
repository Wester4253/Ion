/**
 * Settings and window-state persistence (the IO half of the pure schemas).
 */

import { app } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { sanitizeShellSettings, type ShellSettings } from "./settingsSchema";
import {
  DEFAULT_WINDOW_STATE,
  sanitizeWindowState,
  type Rect,
  type WindowState,
} from "./windowState";
import type { DisplayArea } from "./windowState";

const SHELL_SETTINGS_FILE = "shell.json";
const WINDOW_STATE_FILE = "window-state.json";

type Writable<T> = { -readonly [K in keyof T]: T[K] };

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Missing or corrupt file: fall back to defaults for every field.
    return null;
  }
}

/** Write JSON atomically (temp file + rename) so a crash cannot truncate state. */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

/**
 * Load, sanitize, and persist-on-change shell settings.
 * Callers receive a mutable object: assignment to any field rewrites the file.
 */
export class ShellSettingsStore {
  public readonly data: ShellSettings;

  constructor(private readonly file: string) {
    this.data = sanitizeShellSettings(readJson(file));
  }

  public set<K extends keyof ShellSettings>(key: K, value: ShellSettings[K]): void {
    (this.data as Writable<ShellSettings>)[key] = value;
    writeJsonAtomic(this.file, this.data);
  }
}

/** Load persisted window state validated against the current display layout. */
export function loadWindowState(file: string, displays: readonly DisplayArea[]): WindowState {
  const raw = readJson(file);
  return raw === null ? DEFAULT_WINDOW_STATE : sanitizeWindowState(raw, displays);
}

/** Reusable writer for window state; debounced by the caller. */
export class WindowStateWriter {
  constructor(private readonly file: string) {}

  public write(bounds: Rect | null, maximized: boolean): void {
    writeJsonAtomic(this.file, { bounds, maximized });
  }
}

export function shellDataDir(): string {
  return join(app.getPath("userData"), "ion");
}

export function shellSettingsPath(): string {
  return join(shellDataDir(), SHELL_SETTINGS_FILE);
}

export function windowStatePath(): string {
  return join(shellDataDir(), WINDOW_STATE_FILE);
}
