/**
 * The contract between platform-neutral core code and whatever shell hosts it.
 *
 * Core defines what it needs; `shell-desktop` (Electron) and a future
 * `shell-android` (WebView) provide implementations. Nothing in core may
 * import Electron or Node — the shell passes its implementation in.
 */

export type ShellKind = "desktop" | "android";

export interface ShellHost {
  readonly kind: ShellKind;
  readonly appVersion: string;

  /**
   * Open a URL with the system handler (browser, mail client).
   * Resolves when the request was handed off, rejects when refused as unsafe.
   */
  openExternal(url: string): Promise<void>;
}
