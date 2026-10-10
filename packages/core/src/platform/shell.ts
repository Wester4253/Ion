/**
 * The contract between platform-neutral core code and whatever shell hosts it.
 *
 * Core defines what it needs; `shell-desktop` (Electron) and a future
 * `shell-android` (WebView) provide implementations. Nothing in core may
 * import Electron or Node — the shell passes its implementation in.
 *
 * The concrete instance is exposed to the injected core bundle as
 * `window.ionShell` by the sandboxed preload.
 */

export type ShellKind = "desktop" | "android";

export type FileEncoding = "utf8" | "base64";

/** Persistence for shell-level settings (window, tray, GPU, ...). */
export interface ShellSettingsApi {
  getAll(): Promise<Record<string, unknown>>;
  /** Returns false when the key or value was refused. */
  set(key: string, value: unknown): Promise<boolean>;
}

/**
 * File access scoped to the Ion data directory. Paths are relative to that
 * root; absolute paths and `..` escapes are refused by the shell.
 */
export interface ShellFileApi {
  /** Reads a file. Rejects when missing, out of scope, or unreadable. */
  readFile(path: string, encoding?: FileEncoding): Promise<string>;
  /** Writes a file, creating parent directories. Rejects out-of-scope paths. */
  writeFile(path: string, data: string, encoding?: FileEncoding): Promise<void>;
  /** Lists a directory. Rejects when missing or out of scope. */
  readdir(path: string): Promise<string[]>;
  /** Creates a directory (and parents). Rejects out-of-scope paths. */
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/**
 * Restricted Node-style `require` for plugin code (BetterDiscord plugins
 * expect it). Allowlisted modules only; anything else throws. Implemented by
 * the shell over its IPC bridge with `nodeIntegration` staying off.
 */
export type ShellRequire = (id: string) => unknown;

export interface ShellHost {
  readonly kind: ShellKind;
  readonly appVersion: string;

  /**
   * Open a URL with the system handler (browser, mail client).
   * Resolves when the request was handed off, rejects when refused as unsafe.
   */
  openExternal(url: string): Promise<void>;

  readonly settings: ShellSettingsApi;
  readonly files: ShellFileApi;
  readonly nodeRequire: ShellRequire;
}

/** Injected by the core bundle as proof that it ran in the main world. */
export interface IonGlobal {
  readonly version: string;
  readonly startedAt: number;
}

declare global {
  interface Window {
    /** Present whenever the Ion preload ran; absent means a broken shell. */
    ionShell?: ShellHost;
    __ION__?: IonGlobal;
  }
}
