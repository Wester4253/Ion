/**
 * Main-process IPC handlers.
 *
 * Rules enforced here (never trusting the renderer):
 * - only Discord documents may talk to us (sender URL validation),
 * - only allowlisted channels exist (the renderer cannot reach anything else),
 * - every payload is re-validated (shape, enum, path scope),
 * - filesystem access is confined to the Ion data directory.
 */

import { app, ipcMain, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadCoreBundle } from "./bundle";
import { isAllowedExternalUrl, isAllowedNavigation } from "./navigation";
import { resolveScopedPath } from "./pathScope";
import { applyShellSettingsPatch, isShellSettingKey } from "./settingsSchema";
import { shellDataDir, type ShellSettingsStore } from "./store";
import {
  IPC,
  type FileEncoding,
  type FsReadRequest,
  type FsResult,
  type FsWriteRequest,
  type ShellInfo,
} from "../shared/ipc";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEncoding(value: unknown): FileEncoding {
  return value === "base64" ? "base64" : "utf8";
}

function parseReadRequest(raw: unknown): FsReadRequest | null {
  if (!isRecord(raw) || typeof raw["path"] !== "string") return null;
  return { path: raw["path"], encoding: parseEncoding(raw["encoding"]) };
}

function parseWriteRequest(raw: unknown): FsWriteRequest | null {
  if (!isRecord(raw) || typeof raw["path"] !== "string" || typeof raw["data"] !== "string")
    return null;
  return { path: raw["path"], data: raw["data"], encoding: parseEncoding(raw["encoding"]) };
}

function parsePathOnly(raw: unknown): string | null {
  return isRecord(raw) && typeof raw["path"] === "string" ? raw["path"] : null;
}

function fail<T>(error: unknown): FsResult<T> {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message };
}

/** Only first-party Discord documents may use the bridge. */
function senderIsTrusted(event: { senderFrame: { url: string } | null }): boolean {
  return isAllowedNavigation(event.senderFrame?.url ?? "");
}

interface IpcContext {
  readonly settings: ShellSettingsStore;
}

export function registerIpcHandlers(context: IpcContext): void {
  const { settings } = context;
  const bundle = loadCoreBundle(
    process.env["ION_CORE_BUNDLE"],
    process.env["ION_UI_BUNDLE"],
    __dirname,
    (file) => readFileSync(file, "utf8"),
    process.env["ION_COMPAT_VENCORD_BUNDLE"],
  );
  if (!bundle.ok) {
    console.error(
      `[ion] core bundle not found (tried ${bundle.tried.join(", ")}): ${bundle.reason}`,
    );
  } else {
    if (!bundle.ui) {
      console.error(`[ion] ui bundle not found — the Ion settings page will not be available`);
    }
    if (!bundle.compatVencord) {
      console.warn(`[ion] compat-vencord bundle not found — Vencord plugins stay disabled`);
    }
  }
  const coreSource = bundle.ok ? bundle.source : "";

  const root = shellDataDir();

  const scoped = (raw: unknown, run: (abs: string) => FsResult<unknown>): FsResult<unknown> => {
    const relative = parsePathOnly(raw);
    if (relative === null) return { ok: false, error: "invalid path" };
    const abs = resolveScopedPath(root, relative);
    if (abs === null) return { ok: false, error: "path escapes the Ion data directory" };
    return run(abs);
  };

  // -- synchronous channels (preload runs before Discord's first script) ----

  ipcMain.on(IPC.coreBundle, (event) => {
    event.returnValue = senderIsTrusted(event) ? coreSource : "";
  });

  ipcMain.on(IPC.shellInfo, (event) => {
    const info: ShellInfo = { kind: "desktop", appVersion: app.getVersion() };
    event.returnValue = senderIsTrusted(event) ? info : null;
  });

  ipcMain.on(IPC.fsRead, (event, raw) => {
    if (!senderIsTrusted(event)) {
      event.returnValue = fail(new Error("untrusted sender"));
      return;
    }
    const req = parseReadRequest(raw);
    if (!req) {
      event.returnValue = { ok: false, error: "invalid read request" } satisfies FsResult<never>;
      return;
    }
    event.returnValue = scoped(req.path, (abs) => {
      try {
        const data = readFileSync(abs, req.encoding === "base64" ? "base64" : "utf8");
        return { ok: true, value: data } satisfies FsResult<string>;
      } catch (error) {
        return fail<string>(error);
      }
    });
  });

  ipcMain.on(IPC.fsWrite, (event, raw) => {
    if (!senderIsTrusted(event)) {
      event.returnValue = fail(new Error("untrusted sender"));
      return;
    }
    const req = parseWriteRequest(raw);
    if (!req) {
      event.returnValue = { ok: false, error: "invalid write request" } satisfies FsResult<never>;
      return;
    }
    event.returnValue = scoped(req.path, (abs) => {
      try {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, req.data, req.encoding === "base64" ? "base64" : "utf8");
        return { ok: true, value: undefined } satisfies FsResult<undefined>;
      } catch (error) {
        return fail<undefined>(error);
      }
    });
  });

  ipcMain.on(IPC.fsReaddir, (event, raw) => {
    if (!senderIsTrusted(event)) {
      event.returnValue = fail(new Error("untrusted sender"));
      return;
    }
    event.returnValue = scoped(raw, (abs) => {
      try {
        return { ok: true, value: readdirSync(abs) } satisfies FsResult<string[]>;
      } catch (error) {
        return fail<string[]>(error);
      }
    });
  });

  ipcMain.on(IPC.fsMkdir, (event, raw) => {
    if (!senderIsTrusted(event)) {
      event.returnValue = fail(new Error("untrusted sender"));
      return;
    }
    event.returnValue = scoped(raw, (abs) => {
      try {
        mkdirSync(abs, { recursive: true });
        return { ok: true, value: undefined } satisfies FsResult<undefined>;
      } catch (error) {
        return fail<undefined>(error);
      }
    });
  });

  ipcMain.on(IPC.fsExists, (event, raw) => {
    if (!senderIsTrusted(event)) {
      event.returnValue = fail(new Error("untrusted sender"));
      return;
    }
    event.returnValue = scoped(
      raw,
      (abs) => ({ ok: true, value: existsSync(abs) }) satisfies FsResult<boolean>,
    );
  });

  // -- async channels -------------------------------------------------------

  ipcMain.handle(IPC.openExternal, async (event, rawUrl: unknown) => {
    if (!senderIsTrusted(event)) return false;
    if (typeof rawUrl !== "string" || !isAllowedExternalUrl(rawUrl)) return false;
    return shell.openExternal(rawUrl);
  });

  ipcMain.handle(IPC.settingsGet, (event) => {
    if (!senderIsTrusted(event)) return null;
    return { ...settings.data };
  });

  ipcMain.handle(IPC.settingsSet, (event, key: unknown, value: unknown) => {
    if (!senderIsTrusted(event)) return false;
    if (typeof key !== "string" || !isShellSettingKey(key)) return false;
    const patched = applyShellSettingsPatch(settings.data, key, value);
    if (!patched) return false;
    settings.set(key, patched[key]);
    return true;
  });
}
