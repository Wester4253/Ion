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
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { dirname, posix } from "node:path";

import { loadCoreBundle } from "./bundle";
import { isAllowedExternalUrl, isAllowedFetchUrl, isAllowedNavigation } from "./navigation";
import { resolveScopedPath } from "./pathScope";
import { applyShellSettingsPatch, isShellSettingKey } from "./settingsSchema";
import { shellDataDir, type ShellSettingsStore } from "./store";
import {
  IPC,
  type FsChange,
  type FileEncoding,
  type FsReadRequest,
  type FsResult,
  type FsUnwatchRequest,
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

function parseUnwatchRequest(raw: unknown): FsUnwatchRequest | null {
  if (!isRecord(raw) || typeof raw["token"] !== "number") return null;
  return { token: raw["token"] };
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
  /** Vencord settings JSON to pre-seed, or null outside harness runs. */
  readonly harnessSeed: string | null;
}

export function registerIpcHandlers(context: IpcContext): void {
  const { settings } = context;
  const bundle = loadCoreBundle(
    process.env["ION_CORE_BUNDLE"],
    process.env["ION_UI_BUNDLE"],
    __dirname,
    (file) => readFileSync(file, "utf8"),
    process.env["ION_COMPAT_VENCORD_BUNDLE"],
    process.env["ION_COMPAT_BD_BUNDLE"],
    process.env["ION_COMPAT_SHELTER_BUNDLE"],
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
    if (!bundle.compatBd) {
      console.warn(`[ion] compat-bd bundle not found — BetterDiscord plugins stay disabled`);
    }
    if (!bundle.compatShelter) {
      console.warn(`[ion] compat-shelter bundle not found — Shelter plugins stay disabled`);
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

  // Harness-only: the seed lets a compat run pre-enable foreign plugins
  // before the compat bundle evaluates its settings store at injection.
  ipcMain.on(IPC.harnessSeed, (event) => {
    event.returnValue = senderIsTrusted(event) ? context.harnessSeed : null;
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
    // `scoped` re-derives the path from the request object (see fsReaddir):
    // passing the parsed string would fail its record check.
    event.returnValue = scoped(raw, (abs) => {
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
    event.returnValue = scoped(raw, (abs) => {
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

  // Live subscriptions. `fs.watch` is not recursive — Linux refuses the
  // option outright — and both theme directories are flat, which is all Ion
  // watches. The token is what the renderer hands back to unsubscribe.
  const watchers = new Map<number, FSWatcher>();
  let nextWatchToken = 1;

  ipcMain.on(IPC.fsWatch, (event, raw) => {
    if (!senderIsTrusted(event)) {
      event.returnValue = fail(new Error("untrusted sender"));
      return;
    }
    const relative = parsePathOnly(raw);
    if (relative === null) {
      event.returnValue = { ok: false, error: "invalid path" } satisfies FsResult<never>;
      return;
    }
    const abs = resolveScopedPath(root, relative);
    if (abs === null) {
      event.returnValue = {
        ok: false,
        error: "path escapes the Ion data directory",
      } satisfies FsResult<never>;
      return;
    }

    const token = nextWatchToken++;
    try {
      const watcher = watch(abs, (_type, file) => {
        // `file` is null when the watched directory itself moved; there is
        // nothing a re-read could act on, so the event is dropped.
        if (file === null) return;
        const change: FsChange = { token, changed: [posix.join(relative, file)] };
        event.sender.send(IPC.fsChanged, change);
      });
      watchers.set(token, watcher);
      // A renderer that goes away without unwatching must not leak a handle.
      event.sender.once("destroyed", () => {
        if (watchers.delete(token)) watcher.close();
      });
      event.returnValue = { ok: true, value: token } satisfies FsResult<number>;
    } catch (error) {
      // A path that is not watchable (missing, or a filesystem that refuses
      // inotify handles) leaves the adapter with the load it already did.
      event.returnValue = fail<never>(error);
    }
  });

  ipcMain.on(IPC.fsUnwatch, (event, raw) => {
    if (!senderIsTrusted(event)) {
      event.returnValue = fail(new Error("untrusted sender"));
      return;
    }
    const request = parseUnwatchRequest(raw);
    if (request === null) {
      event.returnValue = { ok: false, error: "invalid watch request" } satisfies FsResult<never>;
      return;
    }
    const watcher = watchers.get(request.token);
    // Already closed (a destroyed renderer, or a double unsubscribe):
    // closing is idempotent from the caller's side, so this is a success.
    if (watcher === undefined) {
      event.returnValue = { ok: true, value: undefined } satisfies FsResult<undefined>;
      return;
    }
    watchers.delete(request.token);
    watcher.close();
    event.returnValue = { ok: true, value: undefined } satisfies FsResult<undefined>;
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

  /** Fetch a URL through the main process (bypasses page CSP/CORS). */
  ipcMain.handle(IPC.fetchUrl, async (event, raw: unknown) => {
    if (!senderIsTrusted(event)) return null;
    if (!isRecord(raw)) return null;
    const url = typeof raw["url"] === "string" ? raw["url"] : null;
    const rawOptions = raw["options"];
    const options: Record<string, unknown> = isRecord(rawOptions) ? rawOptions : {};
    if (url === null || !isAllowedFetchUrl(url)) return null;
    try {
      // Built field by field: `exactOptionalPropertyTypes` rejects assigning
      // `undefined` to an optional property, so each one is set only when the
      // caller actually sent it.
      const init: RequestInit = {
        method: typeof options["method"] === "string" ? options["method"] : "GET",
      };
      if (isRecord(options["headers"])) init.headers = options["headers"] as Record<string, string>;
      if (typeof options["body"] === "string") init.body = options["body"];
      if (typeof options["redirect"] === "string")
        init.redirect = options["redirect"] as "follow" | "error" | "manual";
      // URL is already validated by the caller; main process fetch has no CSP/CORS
      const res = await fetch(url, init);
      if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText };
      const text = await res.text();
      return {
        ok: true,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        text,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
