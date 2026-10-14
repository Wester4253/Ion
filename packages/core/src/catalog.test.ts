import { describe, expect, it, vi } from "vitest";

import {
  fetchCatalog,
  fetchSource,
  downloadEntry,
  stageFile,
  type CatalogEntry,
  type CatalogDeps,
} from "./catalog";

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    description: "A test plugin",
    author: "TestAuthor",
    source: "betterdiscord",
    type: "plugin",
    ecosystem: "bd",
    url: "https://example.com/test.plugin.js",
    filename: "test.plugin.js",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CatalogDeps> = {}): CatalogDeps {
  return {
    fetch: {
      fetch: vi.fn().mockResolvedValue(new Response("test file contents", { status: 200 })),
    },
    files: {
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn(),
      mkdir: vi.fn(),
      exists: vi.fn(),
      watch: vi.fn(),
    },
    ...overrides,
  };
}

describe("fetchCatalog", () => {
  it("fetches from all three sources", async () => {
    const deps = makeDeps({
      fetch: {
        fetch: vi.fn().mockImplementation((url: string) => {
          if (url.includes("betterdiscord")) {
            return Promise.resolve(
              new Response(
                JSON.stringify([{ name: "BD Plugin", download_url: "https://example.com/bd.js" }]),
              ),
            );
          }
          if (url.includes("shindex")) {
            return Promise.resolve(
              new Response(
                JSON.stringify([
                  { plugins: [{ name: "Shelter Plugin", url: "https://example.com/shelter.js" }] },
                ]),
              ),
            );
          }
          // ion-index
          return Promise.resolve(
            new Response(
              JSON.stringify({
                format: "ion-index/vencord-artifacts/v1",
                plugins: [
                  {
                    name: "Vencord Plugin",
                    file: "https://example.com/vencord.js",
                    bytes: 100,
                    sha256: "abc123",
                  },
                ],
              }),
            ),
          );
        }),
      },
    });
    const entries = await fetchCatalog(deps);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.name).toBe("BD Plugin");
    expect(entries[1]?.name).toBe("Shelter Plugin");
    expect(entries[2]?.name).toBe("Vencord Plugin");
  });

  it("returns partial results when one source fails", async () => {
    const deps = makeDeps({
      fetch: {
        fetch: vi.fn().mockImplementation((url: string) => {
          if (url.includes("betterdiscord")) {
            return Promise.resolve(
              new Response(
                JSON.stringify([{ name: "BD Plugin", download_url: "https://example.com/bd.js" }]),
              ),
            );
          }
          if (url.includes("shindex")) {
            return Promise.reject(new Error("network error"));
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                format: "ion-index/vencord-artifacts/v1",
                plugins: [
                  {
                    name: "Vencord Plugin",
                    file: "https://example.com/vencord.js",
                    bytes: 100,
                    sha256: "abc123",
                  },
                ],
              }),
            ),
          );
        }),
      },
    });
    const entries = await fetchCatalog(deps);
    expect(entries.length).toBe(2);
  });
});

describe("fetchSource", () => {
  it("fetches only the requested source", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ name: "BD Plugin", download_url: "https://example.com/bd.js" }]),
        ),
      );
    const deps = makeDeps({ fetch: { fetch: fetchMock } });
    const entries = await fetchSource(deps, "betterdiscord");
    expect(entries.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.betterdiscord.app/v1/store/addons");
  });
});

describe("downloadEntry", () => {
  it("downloads and verifies sha256 when present", async () => {
    const entry = makeEntry({
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    const deps = makeDeps({
      fetch: {
        fetch: vi.fn().mockResolvedValue(new Response("hello", { status: 200 })),
      },
    });
    const file = await downloadEntry(deps, entry);
    expect(file.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(file.bytes).toBeInstanceOf(Uint8Array);
  });

  it("throws on hash mismatch", async () => {
    const entry = makeEntry({
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    });
    const deps = makeDeps({
      fetch: { fetch: vi.fn().mockResolvedValue(new Response("hello")) },
    });
    await expect(downloadEntry(deps, entry)).rejects.toThrow("Hash mismatch");
  });
});

describe("stageFile", () => {
  it("writes to the correct staging directory", async () => {
    const entry = makeEntry();
    const file = { entry, bytes: new TextEncoder().encode("test"), sha256: "abc" };
    const deps = makeDeps();
    const result = await stageFile(deps, file);
    expect(result).toEqual({ ok: true, path: "bd/plugins/test.plugin.js" });
  });

  it("returns an error when write fails", async () => {
    const entry = makeEntry();
    const file = { entry, bytes: new TextEncoder().encode("test"), sha256: "abc" };
    const deps = makeDeps({
      files: {
        readFile: vi.fn(),
        writeFile: vi.fn().mockRejectedValue(new Error("disk full")),
        readdir: vi.fn(),
        mkdir: vi.fn(),
        exists: vi.fn(),
        watch: vi.fn(),
      },
    });
    const result = await stageFile(deps, file);
    expect(result).toEqual({ ok: false, error: "disk full" });
  });
});
