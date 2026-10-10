/**
 * The restricted Node-style `require` exposed to the injected core and to
 * plugin code (BetterDiscord plugins call `require("fs")` and friends).
 *
 * Design:
 * - allowlist only: unknown modules throw loudly,
 * - `fs` runs over synchronous IPC confined to the Ion data directory
 *   (the page itself keeps `nodeIntegration: false` — Node never loads here),
 * - `path` is a local reimplementation (the sandbox cannot load `node:path`),
 * - `electron` is a gated subset; IPC channels are filtered twice (here and
 *   again in the main process).
 */

import type { ShellRequire } from "@ion/core";

import { IPC, isIonChannel, type FsResult } from "../shared/ipc";
import { createPathApi } from "./pathApi";

export interface RequireTransport {
  /** Synchronous request over an allowlisted channel; returns the raw reply. */
  send(channel: string, payload?: unknown): unknown;
  /** Asynchronous request over an allowlisted channel. */
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  /** Open a URL with the system handler; resolves true when handed off. */
  openExternal(url: string): Promise<boolean>;
  /** Subscribe to an allowlisted channel (returns an unsubscribe function). */
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
}

export const ALLOWED_SHELL_MODULES: ReadonlySet<string> = new Set([
  "fs",
  "path",
  "electron",
  "events",
  "timers",
  "url",
]);

function expectOk(reply: unknown): unknown {
  const result = reply as FsResult<unknown> | undefined;
  if (!result || typeof result !== "object" || !("ok" in result)) {
    throw new Error("[ion] no reply from the shell");
  }
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function bytesToBase64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type EncodingArg = string | { encoding?: string } | undefined;

function encodingOf(options: EncodingArg): string {
  if (typeof options === "string") return options;
  return options?.encoding ?? "utf8";
}

interface IonFsModule {
  readFileSync(path: string, options?: EncodingArg): string | Uint8Array;
  writeFileSync(path: string, data: string | Uint8Array, options?: EncodingArg): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

function createFsModule(transport: RequireTransport): IonFsModule {
  return {
    readFileSync(path, options) {
      const encoding = encodingOf(options);
      if (encoding === "utf8" || encoding === "base64") {
        return expectOk(transport.send(IPC.fsRead, { path, encoding })) as string;
      }
      // Binary read: the shell answers base64, we hand back raw bytes.
      const base64 = expectOk(transport.send(IPC.fsRead, { path, encoding: "base64" })) as string;
      return base64ToBytes(base64);
    },

    writeFileSync(path, data, options) {
      if (typeof data === "string") {
        expectOk(transport.send(IPC.fsWrite, { path, data, encoding: encodingOf(options) }));
        return;
      }
      expectOk(
        transport.send(IPC.fsWrite, { path, data: bytesToBase64(data), encoding: "base64" }),
      );
    },

    existsSync(path) {
      return expectOk(transport.send(IPC.fsExists, { path })) as boolean;
    },

    readdirSync(path) {
      return expectOk(transport.send(IPC.fsReaddir, { path })) as string[];
    },

    mkdirSync(path) {
      expectOk(transport.send(IPC.fsMkdir, { path }));
    },
  };
}

function createElectronSubset(transport: RequireTransport): Record<string, unknown> {
  const requireChannel = (channel: string): void => {
    if (!isIonChannel(channel)) throw new Error(`[ion] IPC channel not allowlisted: ${channel}`);
  };

  return {
    shell: {
      openExternal: (url: unknown) => {
        if (typeof url !== "string")
          return Promise.reject(new Error("[ion] openExternal: url must be a string"));
        return transport.openExternal(url);
      },
    },
    ipcRenderer: {
      sendSync: (channel: unknown, ...args: unknown[]) => {
        if (typeof channel !== "string")
          throw new Error("[ion] sendSync: channel must be a string");
        requireChannel(channel);
        return transport.send(channel, args[0]);
      },
      invoke: (channel: unknown, ...args: unknown[]) => {
        // Async API: refusals reject like ipcRenderer.invoke does.
        if (typeof channel !== "string") {
          return Promise.reject(new Error("[ion] invoke: channel must be a string"));
        }
        if (!isIonChannel(channel)) {
          return Promise.reject(new Error(`[ion] IPC channel not allowlisted: ${channel}`));
        }
        return transport.invoke(channel, ...args);
      },
      on: (channel: unknown, listener: unknown) => {
        if (typeof channel !== "string" || typeof listener !== "function") {
          throw new Error("[ion] on: channel and listener required");
        }
        requireChannel(channel);
        return transport.on(channel, listener as (...args: unknown[]) => void);
      },
    },
  };
}

/**
 * Build the `require` function. `platform` is injectable for tests; the
 * production call site passes the preload's `process.platform`.
 */
export function createNodeRequire(
  transport: RequireTransport,
  platform: NodeJS.Platform,
): ShellRequire {
  const pathApi = createPathApi(platform);
  const fsModule = createFsModule(transport);
  const electronSubset = createElectronSubset(transport);

  return (id: string): unknown => {
    switch (id) {
      case "fs":
        return fsModule;
      case "path":
        return pathApi;
      case "electron":
        return electronSubset;
      case "events":
      case "timers":
      case "url": {
        // Sandbox-safe builtins: Electron's restricted require provides these,
        // so this must stay a runtime require, not a static import.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(id);
      }
      default:
        throw new Error(`[ion] require(${JSON.stringify(id)}) is not allowlisted`);
    }
  };
}
