/**
 * The IPC contract between the sandboxed preload and the main process.
 *
 * Pure and unit-tested: the renderer may only ever name channels from this
 * allowlist, and the main process validates every request independently
 * (channels, URLs, paths) rather than trusting the sender.
 */

export const IPC = {
  /** sendSync: source of the Ion core bundle for main-world injection. */
  coreBundle: "ion:core-bundle",
  /** sendSync: harness-only Vencord settings seed (null outside harness runs). */
  harnessSeed: "ion:harness-seed",
  /** sendSync: static shell facts (kind, versions). */
  shellInfo: "ion:shell-info",
  /** invoke: hand a URL to the system handler. */
  openExternal: "ion:open-external",
  /** invoke: read shell settings. */
  settingsGet: "ion:settings-get",
  /** invoke: persist one validated shell setting. */
  settingsSet: "ion:settings-set",
  /** sendSync: scoped filesystem reads. */
  fsRead: "ion:fs:read",
  /** sendSync: scoped filesystem writes. */
  fsWrite: "ion:fs:write",
  /** sendSync: scoped directory listing. */
  fsReaddir: "ion:fs:readdir",
  /** sendSync: scoped directory creation. */
  fsMkdir: "ion:fs:mkdir",
  /** sendSync: scoped existence check. */
  fsExists: "ion:fs:exists",
  /** sendSync: subscribe to changes under a scoped path. */
  fsWatch: "ion:fs:watch",
  /** sendSync: drop a subscription by its token. */
  fsUnwatch: "ion:fs:unwatch",
  /** main → renderer: the files that changed under a subscribed path. */
  fsChanged: "ion:fs:changed",
} as const;

export type IonChannel = (typeof IPC)[keyof typeof IPC];

const CHANNELS: ReadonlySet<string> = new Set(Object.values(IPC));

/** Whether a channel name is on Ion's allowlist. */
export function isIonChannel(channel: string): boolean {
  return CHANNELS.has(channel);
}

/** Encoding options accepted by the scoped filesystem bridge. */
export type FileEncoding = "utf8" | "base64";

export interface FsReadRequest {
  readonly path: string;
  readonly encoding: FileEncoding;
}

export interface FsWriteRequest {
  readonly path: string;
  readonly data: string;
  readonly encoding: FileEncoding;
}

export interface FsWatchRequest {
  readonly path: string;
}

export interface FsUnwatchRequest {
  readonly token: number;
}

/**
 * One filesystem change, reported for a subscription. Paths are relative to
 * the Ion data directory, exactly like every other bridge call.
 */
export interface FsChange {
  readonly token: number;
  readonly changed: readonly string[];
}

/** Envelope for synchronous filesystem calls; errors never cross as throws. */
export type FsResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface ShellInfo {
  readonly kind: "desktop" | "android";
  readonly appVersion: string;
}
