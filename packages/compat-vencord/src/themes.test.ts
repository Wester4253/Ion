// @vitest-environment happy-dom
/**
 * Unit tests for the Vencord theme loader and the `VencordNative.themes`
 * surface it answers: loading, the plain-CSS fallback, per-file isolation,
 * hot reload, and the two calls Ion cannot honour (delete, open folder)
 * saying exactly why instead of pretending.
 */

// The loader's contract IS console output for skipped files, and the
// compatible messages this suite asserts on live there.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared theme engine arrives on the host global at runtime (adapters
// never bundle core), so the suite installs the real one: what is under test
// is that the adapter drives it with the right directory and reader.
import type { IonTheme } from "@ion/core";
import { parseThemeHeader, syncThemeDirectory, watchThemesDir } from "@ion/core";
import {
  deleteVencordTheme,
  listVencordThemes,
  loadVencordThemes,
  openVencordThemesFolder,
  readVencordThemeData,
  reloadVencordTheme,
  watchVencordThemes,
  writeVencordTheme,
} from "./themes";

function themeHeader(name: string): string {
  return `/**
 * @name ${name}
 * @version 2.0.0
 * @description A Vencord theme
 * @author Tester
 */
`;
}

interface FakeShell {
  /** Writes a file the way a user dropping one in would. */
  write(filename: string, data: string): Promise<void>;
  /** Reports a change under the themes directory, as the shell does. */
  notify(path: string): void;
  unsubscribed(): boolean;
}

/** The `window.ionShell` bridge: an in-memory `vencord/themes`. */
function installShell(files: Record<string, string>): FakeShell {
  const store = new Map(Object.entries(files));
  const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

  let listener: ((changed: readonly string[]) => void) | undefined;
  let unsubscribed = false;
  Object.defineProperty(window, "ionShell", {
    configurable: true,
    value: {
      files: {
        readdir: (): Promise<string[]> => Promise.resolve([...store.keys()]),
        readFile: (path: string): Promise<string> => {
          const content = store.get(basename(path));
          return content === undefined
            ? Promise.reject(new Error(`ENOENT: ${path}`))
            : Promise.resolve(content);
        },
        writeFile: (path: string, data: string): Promise<void> => {
          store.set(basename(path), data);
          return Promise.resolve();
        },
        watch: (_path: string, onChanged: (changed: readonly string[]) => void) => {
          listener = onChanged;
          return () => {
            unsubscribed = true;
            listener = undefined;
          };
        },
      },
    },
  });

  return {
    write(filename, data) {
      store.set(filename, data);
      return Promise.resolve();
    },
    notify: (path) => listener?.([path]),
    unsubscribed: () => unsubscribed,
  };
}

/** The Ion host: the theme store plus the shared engine. */
function installHost(): readonly IonTheme[] {
  const registered: IonTheme[] = [];
  const resolve = (idOrNameOrFilename: string): IonTheme | undefined =>
    registered.find(
      (theme) =>
        theme.id === idOrNameOrFilename ||
        theme.name === idOrNameOrFilename ||
        theme.filename === idOrNameOrFilename,
    );

  Object.defineProperty(window, "__ION__", {
    configurable: true,
    value: {
      version: "test",
      startedAt: 0,
      storage: { read: () => null, write: () => undefined },
      themes: {
        register(theme: IonTheme) {
          if (registered.some((entry) => entry.id === theme.id)) {
            throw new Error(`theme id already registered: ${theme.id}`);
          }
          if (registered.some((entry) => entry.name === theme.name)) {
            throw new Error(`theme name already registered: ${theme.name}`);
          }
          registered.push(theme);
        },
        unregister: (idOrNameOrFilename: string) => {
          const theme = resolve(idOrNameOrFilename);
          if (!theme) return false;
          registered.splice(registered.indexOf(theme), 1);
          return true;
        },
        get: resolve,
        list: () => registered,
        isEnabled: () => true,
        setEnabled: () => true,
        subscribe: () => () => undefined,
      },
      themeHost: {
        parseHeader: parseThemeHeader,
        syncDirectory: syncThemeDirectory,
        watchDirectory: watchThemesDir,
      },
    },
  });
  return registered;
}

let registered: readonly IonTheme[];

beforeEach(() => {
  registered = installHost();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("loadVencordThemes", () => {
  it("registers themes with parsed metadata and full CSS", async () => {
    const source = `${themeHeader("Aurora")}body { color: red; }`;
    installShell({
      "Aurora.theme.css": source,
      "notes.txt": "not a theme",
    });

    expect(await loadVencordThemes()).toEqual(["vc.Aurora"]);
    expect(registered).toEqual([
      {
        id: "vc.Aurora",
        name: "Aurora",
        description: "A Vencord theme",
        authors: ["Tester"],
        version: "2.0.0",
        filename: "Aurora.theme.css",
        css: source,
      },
    ]);
  });

  it("registers a header-less stylesheet named after its file", async () => {
    installShell({ "Handwritten.css": ":root { --x: 1; }" });

    expect(await loadVencordThemes()).toEqual(["vc.Handwritten"]);
    expect(registered[0]?.authors).toEqual([]);
    expect(registered[0]?.version).toBeUndefined();
  });

  it("keeps one broken file from blocking the others", async () => {
    installShell({
      "Aurora.theme.css": `${themeHeader("Aurora")}body {}`,
      "Broken.theme.css": "/**",
    });

    // Both are plain CSS at worst, so both load; the split entry is the one
    // that would have failed an upstream parser.
    expect(await loadVencordThemes()).toEqual(["vc.Aurora", "vc.Broken"]);
  });

  it("treats a missing themes directory as nothing to load", async () => {
    Object.defineProperty(window, "ionShell", {
      configurable: true,
      value: {
        files: {
          readdir: () => Promise.reject(new Error(`ENOENT: vencord/themes`)),
        },
      },
    });

    expect(await loadVencordThemes()).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("no vencord/themes directory"),
    );
  });

  it("treats a missing shell bridge as nothing to load", async () => {
    Object.defineProperty(window, "ionShell", { configurable: true, value: undefined });

    expect(await loadVencordThemes()).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("no shell bridge: the vencord/themes directory was not read"),
    );
  });
});

describe("reloadVencordTheme", () => {
  it("re-reads a changed file, swapping it into the store", async () => {
    installShell({ "Aurora.theme.css": `${themeHeader("Aurora")}body { color: red; }` });
    await loadVencordThemes();

    await writeVencordTheme("Aurora.theme.css", `${themeHeader("Aurora")}body { color: blue; }`);
    await expect(reloadVencordTheme("Aurora")).resolves.toBe(true);

    expect(registered).toHaveLength(1);
    expect(registered[0]?.css).toContain("blue");
  });

  it("keeps the running theme when the file is unreadable", async () => {
    installShell({ "Aurora.theme.css": `${themeHeader("Aurora")}body { color: red; }` });
    await loadVencordThemes();

    Object.defineProperty(window, "ionShell", {
      configurable: true,
      value: {
        files: {
          readdir: () => Promise.resolve(["Aurora.theme.css"]),
          readFile: () => Promise.reject(new Error("ENOENT")),
        },
      },
    });

    await expect(reloadVencordTheme("vc.Aurora")).resolves.toBe(false);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.css).toContain("red");
  });

  it("answers false for an unknown theme", async () => {
    installShell({});

    await expect(reloadVencordTheme("Ghost")).resolves.toBe(false);
  });
});

describe("watchVencordThemes", () => {
  it("re-reads the directory when the shell reports a change", async () => {
    vi.useFakeTimers();
    const shell = installShell({ "Aurora.theme.css": `${themeHeader("Aurora")}body {}` });
    await loadVencordThemes();
    watchVencordThemes();

    await shell.write("Late.css", "body { color: blue; }");
    shell.notify("vencord/themes/Late.css");
    await vi.advanceTimersByTimeAsync(200);

    expect(registered.map((theme) => theme.filename)).toEqual(["Aurora.theme.css", "Late.css"]);
  });
});

describe("VencordNative.themes", () => {
  it("lists the directory with header identity, or file identity", async () => {
    installShell({
      "Aurora.theme.css": `${themeHeader("Aurora")}body {}`,
      "Plain.css": ":root {}",
    });

    expect(await listVencordThemes()).toEqual([
      {
        fileName: "Aurora.theme.css",
        name: "Aurora",
        author: "Tester",
        description: "A Vencord theme",
        version: "2.0.0",
      },
      {
        fileName: "Plain.css",
        name: "Plain",
        author: "Unknown Author",
        description: "No description provided",
        version: undefined,
      },
    ]);
  });

  it("answers getThemeData with the file's CSS", async () => {
    installShell({ "Aurora.theme.css": "body { color: red; }" });

    await expect(readVencordThemeData("Aurora.theme.css")).resolves.toBe("body { color: red; }");
  });

  it("rejects getThemeData for a file that is not there", async () => {
    installShell({});

    await expect(readVencordThemeData("Ghost.css")).rejects.toThrow("ENOENT");
  });

  it("uploads a theme into the directory, refusing unsafe names", async () => {
    installShell({});

    await expect(writeVencordTheme("New.css", "body {}")).resolves.toBeUndefined();
    expect(await readVencordThemeData("New.css")).toBe("body {}");

    for (const bad of ["../escape.css", "nested/New.css", "New.css.txt", ""]) {
      await expect(writeVencordTheme(bad, "body {}")).rejects.toThrow(/refused theme file name/);
    }
  });

  it("refuses to delete, naming the step the user has to take", async () => {
    await expect(deleteVencordTheme("Aurora.theme.css")).rejects.toThrow(
      "remove the file in your file manager",
    );
  });

  it("refuses to open the folder, saying why", () => {
    const open = (): void => {
      openVencordThemesFolder();
    };
    expect(open).toThrow("Ion cannot open vencord/themes");
  });
});
