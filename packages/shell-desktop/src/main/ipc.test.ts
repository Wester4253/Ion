/**
 * End-to-end tests for the filesystem IPC bridge — the contract every
 * adapter rides (core settings, the theme store, BetterDiscord's plugin
 * directory). Electron is mocked; the handler wiring, request validation,
 * and path scoping under test are the real code.
 *
 * These tests exist because a wiring mistake here once failed every
 * `readFile`/`writeFile` with "invalid path" (the handlers passed the
 * parsed path string where the scoper expects the request object); the
 * first measured BetterDiscord run caught it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IPC, type FsResult } from "../shared/ipc";
import { registerIpcHandlers } from "./ipc";
import { ShellSettingsStore } from "./store";

interface IpcEvent {
  senderFrame: { url: string } | null;
  returnValue: unknown;
}
type IpcHandler = (event: IpcEvent, raw: unknown) => void;

const { handlers, electronState } = vi.hoisted(() => {
  interface HoistedEvent {
    senderFrame: { url: string } | null;
    returnValue: unknown;
  }
  type HoistedHandler = (event: HoistedEvent, raw: unknown) => void;
  return {
    handlers: new Map<string, HoistedHandler>(),
    electronState: { userData: "" },
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: () => electronState.userData,
    getVersion: () => "0.0.0-test",
  },
  BrowserWindow: {
    fromWebContents: () => null,
  },
  ipcMain: {
    on: (channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    },
    handle: (channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    },
  },
  shell: { openExternal: () => Promise.resolve() },
}));

/** Invoke a registered channel as a trusted Discord document would. */
function invoke(channel: string, raw: unknown): FsResult<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  const event: IpcEvent = {
    senderFrame: { url: "https://discord.com/app/" },
    returnValue: undefined,
  };
  handler(event, raw);
  return event.returnValue as FsResult<unknown>;
}

let userData: string;

beforeEach(() => {
  // The core bundle is absent in tests; its "not found" report is noise here.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  userData = mkdtempSync(join(tmpdir(), "ion-ipc-test-"));
  electronState.userData = userData;
  handlers.clear();
  registerIpcHandlers({
    settings: new ShellSettingsStore(join(userData, "shell.json")),
    harnessSeed: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(userData, { recursive: true, force: true });
});

describe("filesystem IPC", () => {
  it("reads back what it wrote, creating parent directories", () => {
    const write = invoke(IPC.fsWrite, {
      path: "bd/plugins/Test.plugin.js",
      data: "source",
      encoding: "utf8",
    });
    expect(write).toEqual({ ok: true, value: undefined });

    const read = invoke(IPC.fsRead, { path: "bd/plugins/Test.plugin.js", encoding: "utf8" });
    expect(read).toEqual({ ok: true, value: "source" });
  });

  it("lists directories and answers existence checks", () => {
    invoke(IPC.fsWrite, { path: "bd/plugins/Test.plugin.js", data: "x", encoding: "utf8" });

    expect(invoke(IPC.fsReaddir, { path: "bd/plugins" })).toEqual({
      ok: true,
      value: ["Test.plugin.js"],
    });
    expect(invoke(IPC.fsExists, { path: "bd/plugins/Test.plugin.js" })).toEqual({
      ok: true,
      value: true,
    });
    expect(invoke(IPC.fsExists, { path: "bd/themes" })).toEqual({ ok: true, value: false });
  });

  it("creates directories on request", () => {
    expect(invoke(IPC.fsMkdir, { path: "settings" })).toEqual({ ok: true, value: undefined });
    expect(invoke(IPC.fsExists, { path: "settings" })).toEqual({ ok: true, value: true });
  });

  it("reports a missing file as an fs error, not a protocol error", () => {
    const read = invoke(IPC.fsRead, { path: "bd/plugins/Missing.plugin.js", encoding: "utf8" });
    expect(read.ok).toBe(false);
  });

  it("refuses paths that escape the Ion data directory", () => {
    for (const channel of [IPC.fsRead, IPC.fsWrite, IPC.fsReaddir]) {
      const result = invoke(channel, { path: "../escape.txt", data: "x", encoding: "utf8" });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`${channel} unexpectedly allowed an escaping path`);
      expect(result.error).toContain("escapes the Ion data directory");
    }
  });

  it("rejects malformed requests before touching the filesystem", () => {
    expect(invoke(IPC.fsRead, {})).toEqual({ ok: false, error: "invalid read request" });
    expect(invoke(IPC.fsRead, "bd/plugins")).toEqual({ ok: false, error: "invalid read request" });
    expect(invoke(IPC.fsWrite, { path: "x" })).toEqual({
      ok: false,
      error: "invalid write request",
    });
  });

  it("refuses untrusted senders", () => {
    const handler = handlers.get(IPC.fsRead);
    if (!handler) throw new Error("no fsRead handler");
    const event: IpcEvent = {
      senderFrame: { url: "https://evil.example/" },
      returnValue: undefined,
    };
    handler(event, { path: "bd/plugins/Test.plugin.js", encoding: "utf8" });
    expect(event.returnValue).toEqual({ ok: false, error: "untrusted sender" });
  });
});

describe("content protection IPC", () => {
  it("answers false when no window owns the sender", () => {
    expect(invoke(IPC.contentProtection, true)).toBe(false);
  });

  it("refuses untrusted senders", () => {
    const handler = handlers.get(IPC.contentProtection);
    if (!handler) throw new Error("no contentProtection handler");
    const event: IpcEvent = {
      senderFrame: { url: "https://evil.example/" },
      returnValue: undefined,
    };
    handler(event, true);
    expect(event.returnValue).toBe(false);
  });
});
