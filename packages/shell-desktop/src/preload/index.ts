/**
 * Ion desktop preload.
 *
 * Runs sandboxed and context-isolated before any page script. Responsibilities, in order:
 *
 * 1. expose the typed bridge (`window.ionShell`) — core's only door to the shell,
 * 2. inject the Ion core bundle into the main world via `webFrame.executeJavaScript`
 *    (privileged evaluation: not subject to page CSP, runs before Discord's scripts).
 *
 * Node stays out of the page: `nodeIntegration` is off, and plugin-grade Node
 * access only exists as the allowlisted `nodeRequire` over IPC.
 */

import { contextBridge, ipcRenderer, webFrame } from "electron";
import type { ShellFileApi, ShellHost, ShellSettingsApi } from "@ion/core";

import { createNodeRequire, type RequireTransport } from "./nodeRequire";
import { IPC, type FsResult, type ShellInfo } from "../shared/ipc";

function send(channel: string, payload?: unknown): unknown {
  const reply = ipcRenderer.sendSync(channel, payload) as FsResult<unknown> | null | undefined;
  if (!reply || typeof reply !== "object" || !("ok" in reply)) {
    throw new Error(`[ion] no reply for ${channel}`);
  }
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

/** Run a synchronous bridge call and settle the promise contract correctly. */
function attempt<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

const shellInfo = ipcRenderer.sendSync(IPC.shellInfo) as ShellInfo | null;
const appVersion =
  shellInfo && typeof shellInfo.appVersion === "string" && shellInfo.appVersion.length > 0
    ? shellInfo.appVersion
    : "dev";

const files: ShellFileApi = {
  readFile(path, encoding = "utf8") {
    return attempt(() => send(IPC.fsRead, { path, encoding }) as string);
  },
  writeFile(path, data, encoding = "utf8") {
    return attempt(() => {
      send(IPC.fsWrite, { path, data, encoding });
    });
  },
  readdir(path) {
    return attempt(() => send(IPC.fsReaddir, { path }) as string[]);
  },
  mkdir(path) {
    return attempt(() => {
      send(IPC.fsMkdir, { path });
    });
  },
  exists(path) {
    return attempt(() => send(IPC.fsExists, { path }) as boolean);
  },
};

const settings: ShellSettingsApi = {
  async getAll() {
    const value = (await ipcRenderer.invoke(IPC.settingsGet)) as Record<string, unknown> | null;
    return value ?? {};
  },
  async set(key, value) {
    return (await ipcRenderer.invoke(IPC.settingsSet, key, value)) === true;
  },
};

const transport: RequireTransport = {
  send: (channel, payload) => ipcRenderer.sendSync(channel, payload) as unknown,
  invoke: async (channel, ...args) => (await ipcRenderer.invoke(channel, ...args)) as unknown,
  openExternal: async (url) => (await ipcRenderer.invoke(IPC.openExternal, url)) === true,
  on: (channel, listener) => {
    const wrapped = (_event: unknown, ...args: unknown[]) => {
      listener(...args);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.off(channel, wrapped);
    };
  },
};

const host: ShellHost = {
  kind: "desktop",
  appVersion,
  async openExternal(url) {
    const opened = (await ipcRenderer.invoke(IPC.openExternal, url)) === true;
    if (!opened) throw new Error(`[ion] refused to open: ${url}`);
  },
  settings,
  files,
  nodeRequire: createNodeRequire(transport, process.platform),
};

contextBridge.exposeInMainWorld("ionShell", host);

// Inject the core bundle into the main world before Discord's first script.
const coreSource = ipcRenderer.sendSync(IPC.coreBundle) as string | null;
if (typeof coreSource === "string" && coreSource.length > 0) {
  void webFrame.executeJavaScript(coreSource).catch((error: unknown) => {
    console.error("[ion] core bundle injection failed:", error);
  });
} else {
  console.error(
    "[ion] core bundle unavailable — run `pnpm build` (packages/core/dist/index.js missing)",
  );
}
