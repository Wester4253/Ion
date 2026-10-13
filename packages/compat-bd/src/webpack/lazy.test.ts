// @vitest-environment happy-dom
/**
 * Unit tests for the webpack chunk-loading helpers. A fake bundler runtime
 * (`.e`/`.u`/`.p` plus factories) stands in for Discord's web runtime;
 * fetch is stubbed so worker detection is exercised both ways.
 */

// The "survives chunk fetch failures" test asserts on the error the
// loader logs; the compat harness attributes plugin failures by reading
// console output back, so referencing it is the point.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";

import { forceLoad, loadEntry } from "./lazy";

interface FakeRequire {
  (id: PropertyKey): unknown;
  m: Record<PropertyKey, unknown>;
  e: ReturnType<typeof vi.fn>;
  u: ReturnType<typeof vi.fn>;
  p: string;
}

let requires: FakeRequire[];
let required: PropertyKey[];

function makeRequire(
  modules: Record<string, unknown>,
  factories: Record<string, unknown>,
): FakeRequire {
  const webpackRequire = Object.assign(
    (id: PropertyKey) => {
      required.push(id);
      return modules[String(id)];
    },
    {
      m: factories,
      e: vi.fn(() => Promise.resolve()),
      u: vi.fn((chunkId: number) => `${String(chunkId)}.chunk.js`),
      p: "/assets/",
    },
  );
  requires.push(webpackRequire);
  return webpackRequire;
}

beforeEach(() => {
  requires = [];
  required = [];
  const discovery = {
    find: () => undefined,
    getRequires: () => requires,
    waitFor: () => () => undefined,
  } as unknown as IonDiscoveryApi;
  (window as unknown as { __ION__: IonGlobal }).__ION__ = { discovery } as unknown as IonGlobal;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ text: () => Promise.resolve("var loaded = true;") })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("forceLoad", () => {
  it("loads a module from its createPromise chunks", async () => {
    const exports42 = { module: 42 };
    const webpackRequire = makeRequire({ 42: exports42 }, {});
    // Factory source shaped like Discord's lazy chunk map entries.
    webpackRequire.m[42] = Object.assign(() => undefined, {
      toString: () => 'module.exports = {createPromise: () => r.e("7").then(r.bind(r, 42))};',
    });

    const loaded = await forceLoad(42);
    expect(webpackRequire.e).toHaveBeenCalledWith(7);
    expect(required).toContain(42);
    expect(loaded).toContain(exports42);
  });

  it("loads bound modules for plain chunk references", async () => {
    const exports5 = { module: 5 };
    const webpackRequire = makeRequire({ 5: exports5 }, {});
    webpackRequire.m[5] = Object.assign(() => undefined, {
      toString: () => 'x = r.e("9"), r.bind(r, 5)',
    });

    const loaded = await forceLoad(5);
    expect(webpackRequire.e).toHaveBeenCalledWith(9);
    expect(loaded).toContain(exports5);
  });

  it("returns an empty list for unknown ids and non-chunk runtimes", async () => {
    makeRequire({}, { 1: () => undefined });
    expect(await forceLoad(1)).toEqual([]);

    // A require without the chunk-loading surface is not a candidate.
    const bare = Object.assign((id: PropertyKey) => id, { m: { 2: () => undefined } });
    requires.push(bare as unknown as FakeRequire);
    expect(await forceLoad(2)).toEqual([]);
  });
});

describe("loadEntry", () => {
  it("evaluates the entry after loading its chunks", async () => {
    const entryExports = { entry: true };
    const webpackRequire = makeRequire({ 9: entryExports }, { 9: () => entryExports });

    const entries = await loadEntry('x = Promise.all([a.e("3"), a.e("4")]).then(a.bind(a, 9))');

    expect(webpackRequire.u).toHaveBeenCalledWith(3);
    expect(webpackRequire.u).toHaveBeenCalledWith(4);
    expect(webpackRequire.e).toHaveBeenCalledWith(3);
    expect(webpackRequire.e).toHaveBeenCalledWith(4);
    expect(entries).toEqual([entryExports]);
  });

  it("skips web-worker chunks but still evaluates the entry", async () => {
    const entryExports = { entry: true };
    const webpackRequire = makeRequire({ 9: entryExports }, { 9: () => entryExports });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          text: () =>
            Promise.resolve(
              url.includes("5.") ? "importScripts('worker.js');" : "var loaded = true;",
            ),
        }),
      ),
    );

    const entries = await loadEntry('x = Promise.all([a.e("5"), a.e("6")]).then(a.bind(a, 9))');

    // Chunk 5 is a worker: never ensured. Chunk 6 loads normally.
    expect(webpackRequire.e).not.toHaveBeenCalledWith(5);
    expect(webpackRequire.e).toHaveBeenCalledWith(6);
    expect(entries).toEqual([entryExports]);
    // The worker detection is cached per call: one fetch per chunk.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("survives chunk fetch failures and still evaluates the entry", async () => {
    const entryExports = { entry: true };
    makeRequire({ 9: entryExports }, { 9: () => entryExports });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    const entries = await loadEntry('x = Promise.all([a.e("3"), a.e("4")]).then(a.bind(a, 9))');

    expect(console.error).toHaveBeenCalled();
    expect(entries).toEqual([entryExports]);
  });

  it("skips chunks with no resolvable file without fetching", async () => {
    const entryExports = { entry: true };
    const webpackRequire = makeRequire({ 9: entryExports }, { 9: () => entryExports });
    webpackRequire.u.mockImplementation(() => undefined);

    const entries = await loadEntry('x = Promise.all([a.e("3"), a.e("4")]).then(a.bind(a, 9))');

    expect(fetch).not.toHaveBeenCalled();
    expect(entries).toEqual([entryExports]);
  });

  it("returns null when the source carries no lazy entry", async () => {
    makeRequire({}, {});
    expect(await loadEntry("function () { return 1; }")).toBeNull();
    expect(await loadEntry(undefined)).toBeNull();
    expect(await loadEntry(() => undefined)).toBeNull();
  });
});
