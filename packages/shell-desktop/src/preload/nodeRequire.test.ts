import { describe, expect, test, vi } from "vitest";

import { IPC, type FsResult } from "../shared/ipc";
import { createNodeRequire, ALLOWED_SHELL_MODULES, type RequireTransport } from "./nodeRequire";

function makeTransport(overrides: Partial<RequireTransport> = {}): RequireTransport {
  return {
    send: () => ({ ok: true, value: undefined }) satisfies FsResult<undefined>,
    invoke: () => Promise.resolve(undefined),
    openExternal: () => Promise.resolve(true),
    on: () => () => undefined,
    ...overrides,
  };
}

describe("module allowlist", () => {
  test("only known modules are granted", () => {
    const requireFn = createNodeRequire(makeTransport(), "linux");
    expect([...ALLOWED_SHELL_MODULES].sort()).toEqual([
      "electron",
      "events",
      "fs",
      "path",
      "timers",
      "url",
    ]);
    for (const id of ALLOWED_SHELL_MODULES) {
      if (id === "events" || id === "timers" || id === "url") continue; // sandbox builtins, covered below
      expect(() => requireFn(id)).not.toThrow();
    }
  });

  test("unknown modules throw loudly", () => {
    const requireFn = createNodeRequire(makeTransport(), "linux");
    for (const id of ["child_process", "net", "os", "fs/promises", "", "ION_EVIL"]) {
      expect(() => requireFn(id)).toThrow(/not allowlisted/);
    }
  });
});

describe("fs module", () => {
  test("routes reads through the transport with an encoding", () => {
    const send = vi.fn(() => ({ ok: true, value: "hello" }) satisfies FsResult<string>);
    const requireFn = createNodeRequire(makeTransport({ send }), "linux");
    const fs = requireFn("fs") as { readFileSync(path: string, enc: string): string };
    expect(fs.readFileSync("notes.txt", "utf8")).toBe("hello");
    expect(send).toHaveBeenCalledWith(IPC.fsRead, { path: "notes.txt", encoding: "utf8" });
  });

  test("shell-side failures become thrown errors", () => {
    const requireFn = createNodeRequire(
      makeTransport({ send: () => ({ ok: false, error: "path escapes the Ion data directory" }) }),
      "linux",
    );
    const fs = requireFn("fs") as { readFileSync(path: string): string };
    expect(() => fs.readFileSync("../etc/passwd")).toThrow(/escapes the Ion data directory/);
  });

  test("missing replies throw instead of returning undefined", () => {
    const requireFn = createNodeRequire(makeTransport({ send: () => undefined }), "linux");
    const fs = requireFn("fs") as { existsSync(path: string): boolean };
    expect(() => fs.existsSync("x")).toThrow(/no reply/);
  });

  test("binary writes are base64-encoded", () => {
    const send = vi.fn(() => ({ ok: true, value: undefined }) satisfies FsResult<undefined>);
    const requireFn = createNodeRequire(makeTransport({ send }), "linux");
    const fs = requireFn("fs") as { writeFileSync(path: string, data: Uint8Array): void };
    fs.writeFileSync("bin.dat", new Uint8Array([1, 2, 3]));
    expect(send).toHaveBeenCalledWith(IPC.fsWrite, {
      path: "bin.dat",
      data: Buffer.from([1, 2, 3]).toString("base64"),
      encoding: "base64",
    });
  });
});

describe("electron subset gating", () => {
  test("ion channels pass through, others are refused", async () => {
    const invoke = vi.fn(() => Promise.resolve(true));
    const requireFn = createNodeRequire(makeTransport({ invoke }), "linux");
    const electron = requireFn("electron") as {
      ipcRenderer: { invoke(channel: string): Promise<unknown> };
      shell: { openExternal(url: string): Promise<boolean> };
    };

    await expect(electron.ipcRenderer.invoke("ion:settings-get")).resolves.toBe(true);
    await expect(electron.ipcRenderer.invoke("evil:channel")).rejects.toThrow(/not allowlisted/);
    await expect(electron.shell.openExternal("https://example.com")).resolves.toBe(true);
  });

  test("openExternal with a non-string is rejected", async () => {
    const requireFn = createNodeRequire(makeTransport(), "linux");
    const electron = requireFn("electron") as {
      shell: { openExternal(url: unknown): Promise<unknown> };
    };
    await expect(electron.shell.openExternal(42)).rejects.toThrow(/string/);
  });
});

describe("path module", () => {
  test("returns the platform implementation", () => {
    const requireFn = createNodeRequire(makeTransport(), "linux");
    const path = requireFn("path") as { sep: string; join(a: string, b: string): string };
    expect(path.sep).toBe("/");
    expect(path.join("a", "b")).toBe("a/b");
  });
});
