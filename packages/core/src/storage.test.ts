// @vitest-environment happy-dom
/**
 * Unit tests for the DOM storage capture.
 *
 * The facade picks its backing store once, at module evaluation, so each case
 * reshapes the window and re-imports a fresh module. That mirrors the real
 * page: the properties exist at document-start and are gone once Discord's
 * own scripts have run.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DomStorage } from "./storage";

type AreaName = "localStorage" | "sessionStorage";

function defineArea(name: AreaName, backing: Map<string, string>): void {
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (key: string): string | null => backing.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        backing.set(key, value);
      },
      removeItem: (key: string): void => {
        backing.delete(key);
      },
    } satisfies Partial<Storage>,
  });
}

/** Removes the property entirely, exactly like Discord's client does. */
function dropArea(name: AreaName): void {
  Object.defineProperty(window, name, { configurable: true, value: undefined });
}

/** Installs an area that rejects every write, like a private-mode window. */
function defineRejectingArea(name: AreaName): void {
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (): void => undefined,
    } satisfies Partial<Storage>,
  });
}

async function freshStorage(): Promise<DomStorage> {
  vi.resetModules();
  const { domStorage } = await import("./storage");
  return domStorage;
}

afterEach(() => {
  vi.resetModules();
});

describe("domStorage", () => {
  it("captures localStorage and round-trips values", async () => {
    defineArea("localStorage", new Map());
    const storage = await freshStorage();

    expect(storage.backend).toBe("localStorage");
    expect(storage.read("missing")).toBeNull();

    storage.write("key", "value");
    expect(storage.read("key")).toBe("value");

    storage.remove("key");
    expect(storage.read("key")).toBeNull();
  });

  it("falls back to sessionStorage when the page removed localStorage", async () => {
    dropArea("localStorage");
    defineArea("sessionStorage", new Map());
    const storage = await freshStorage();

    expect(storage.backend).toBe("sessionStorage");
    storage.write("key", "value");
    expect(storage.read("key")).toBe("value");
  });

  it("keeps values in memory when no area survives the capture", async () => {
    dropArea("localStorage");
    dropArea("sessionStorage");
    const storage = await freshStorage();

    expect(storage.backend).toBe("memory");

    storage.write("key", "value");
    expect(storage.read("key")).toBe("value");

    storage.remove("key");
    expect(storage.read("key")).toBeNull();
  });

  it("probes write access, so a private-mode area is never selected", async () => {
    dropArea("sessionStorage");
    defineRejectingArea("localStorage");
    const storage = await freshStorage();

    expect(storage.backend).toBe("memory");
  });
});
