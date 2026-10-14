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
import type { ShellFileApi, ShellHost, ShellSettingsApi, ShellFetchApi } from "@ion/core";

import { createNodeRequire, type RequireTransport } from "./nodeRequire";
import { IPC, type FsChange, type FsResult, type ShellInfo } from "../shared/ipc";

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
  watch(path, onChanged) {
    const token = send(IPC.fsWatch, { path }) as number;
    // Every watcher in the page shares this one channel; the token is what
    // keeps a change for one directory away from another's listener.
    const listener = (_event: unknown, change: FsChange): void => {
      if (change.token !== token) return;
      onChanged(change.changed);
    };
    ipcRenderer.on(IPC.fsChanged, listener);
    return () => {
      ipcRenderer.off(IPC.fsChanged, listener);
      try {
        send(IPC.fsUnwatch, { token });
      } catch (error) {
        // The main process already dropped it (the window is going away):
        // there is nothing left to release and nothing the caller can do.
        console.error("[ion] could not unwatch", path, error);
      }
    };
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

/** The `ion:fetch-url` reply shape, defensively parsed off the IPC boundary. */
interface FetchReply {
  readonly ok: boolean;
  readonly status?: number;
  readonly statusText?: string;
  readonly headers?: Record<string, string>;
  readonly text?: string;
  readonly error?: string;
}

function parseFetchReply(reply: unknown): FetchReply | null {
  if (typeof reply !== "object" || reply === null) return null;
  const record = reply as Record<string, unknown>;
  // Optional fields are set only when present: `exactOptionalPropertyTypes`
  // rejects assigning `undefined` to an optional property outright, and the
  // mapped type drops `readonly` so the fields can be assigned one by one.
  const result: FetchReply = {
    ok: record["ok"] === true,
    ...(typeof record["status"] === "number" ? { status: record["status"] } : {}),
    ...(typeof record["statusText"] === "string" ? { statusText: record["statusText"] } : {}),
    ...(typeof record["text"] === "string" ? { text: record["text"] } : {}),
    ...(typeof record["error"] === "string" ? { error: record["error"] } : {}),
    ...(typeof record["headers"] === "object" && record["headers"] !== null
      ? { headers: record["headers"] as Record<string, string> }
      : {}),
  };
  return result;
}

const fetchApi: ShellFetchApi = {
  async fetch(url, options) {
    const reply: unknown = await ipcRenderer.invoke(IPC.fetchUrl, {
      url,
      options: options ?? {},
    });
    const result = parseFetchReply(reply);
    if (result?.ok !== true) {
      const status = result?.status ?? "unknown";
      const message =
        result?.error ?? result?.statusText ?? `fetch failed (status ${String(status)})`;
      throw new Error(message);
    }
    const init: ResponseInit = {
      status: result.status ?? 200,
      statusText: result.statusText ?? "OK",
    };
    if (result.headers !== undefined) init.headers = result.headers;
    return new Response(result.text ?? "", init);
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
  fetch: fetchApi,
  nodeRequire: createNodeRequire(transport, process.platform),
};

contextBridge.exposeInMainWorld("ionShell", host);

// Inject the core bundle into the main world before Discord's first script.
// The harness seed must land first: the compat bundle's Vencord settings
// store reads this key synchronously when it evaluates during injection.
const harnessSeed = ipcRenderer.sendSync(IPC.harnessSeed) as string | null;
if (harnessSeed !== null) {
  try {
    window.localStorage.setItem("ion.vencord.settings", harnessSeed);
  } catch (error) {
    console.error("[ion] harness settings seed failed:", error);
  }
}
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
