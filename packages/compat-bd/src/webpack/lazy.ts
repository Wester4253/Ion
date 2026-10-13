/**
 * Webpack chunk loading — a behavioral port of the `forceLoad` and
 * `loadEntry` helpers in BetterDiscord's src/betterdiscord/webpack/lazy.ts
 * (Apache-2.0, see THIRD_PARTY.md).
 *
 * Upstream runs against a single global `__webpack_require__`. Discord
 * ships several bundler runtimes on one page, so this targets the captured
 * requires that actually expose the chunk-loading surface (`.e`/`.u`/`.p`)
 * — on Discord's web client, the main web runtime.
 *
 * The regexes are constructed per call instead of module-level with the
 * `g` flag: `exec` state would leak between calls (upstream resets only by
 * exhausting the loop), and per-call instances make each call independent.
 */

import { Logger } from "../common/logger";
import { discovery } from "../host";

const CHUNK_ID_SOURCE = String.raw`.{1}\.e\("(\d+)"\)`;
const FINAL_MODULE_ID_SOURCE = String.raw`.{1}\.bind\(.{1},\s*(\d+)\s*\)`;
const CREATE_PROMISE_SOURCE = String.raw`createPromise:\s*\(\)\s*=>\s*([^}]+)\.then\(.{1}\.bind\(.{1},\s*(\d+)\)\)`;
const LAZY_CHUNK_SOURCE = String.raw`Promise\.all\(\[((?:\w\.e\("?\d+"?\),?)+)\]\)\.then\(\w(?:\.\w)?\.bind\(\w,\s*"?(\d+)"?\)\)`;
const WHITESPACE = /\s+/g;

const WORKER_CHUNK = /importScripts\(|self\.postMessage/;

/** The chunk-loading surface of a captured `__webpack_require__`. */
interface ChunkLoadingRequire {
  (id: PropertyKey): unknown;
  readonly m: Record<PropertyKey, unknown>;
  /** Ensures the chunk with `chunkId` is downloaded and evaluated. */
  e(chunkId: string | number): Promise<unknown>;
  /** The chunk's file name, relative to the public path. */
  u(chunkId: string | number): string | undefined;
  /** The public path chunks are fetched from. */
  readonly p: string;
}

/**
 * Captured requires that can load chunks: the ones with `ensure`, a URL
 * builder, and a public path — the main web runtime's surface.
 */
function chunkLoadingRequires(): ChunkLoadingRequire[] {
  const found: ChunkLoadingRequire[] = [];
  for (const webpackRequire of discovery().getRequires()) {
    const candidate = webpackRequire as unknown as { e?: unknown; u?: unknown; p?: unknown };
    if (
      typeof candidate.e === "function" &&
      typeof candidate.u === "function" &&
      typeof candidate.p === "string"
    ) {
      found.push(webpackRequire as unknown as ChunkLoadingRequire);
    }
  }
  return found;
}

/**
 * Loads the chunks a module factory references and evaluates the modules
 * they deliver — BetterDiscord's escape hatch for features Discord only
 * fetches on demand.
 *
 * @param id The module id to force-load.
 * @returns The loaded modules (empty when no runtime knows the id).
 */
export async function forceLoad(id: string | number): Promise<unknown[]> {
  const loadedModules: unknown[] = [];

  for (const webpackRequire of chunkLoadingRequires()) {
    const factory = webpackRequire.m[id];
    // `String()` reaches the factory proxy's `toString`, which returns the
    // original (unwrapped) source text.
    if (typeof factory !== "function") continue;
    const text = String(factory);

    // `createPromise: () => X.e("chunk").then(X.bind(X, id))` — load the
    // referenced chunks, then evaluate the bound module.
    for (const [, promiseBody, bindId] of text.matchAll(new RegExp(CREATE_PROMISE_SOURCE, "g"))) {
      if (promiseBody === undefined || bindId === undefined) continue;
      const chunkIds = Array.from(
        promiseBody.matchAll(new RegExp(CHUNK_ID_SOURCE, "g")),
        (match) => match[1],
      ).filter((chunkId): chunkId is string => chunkId !== undefined);
      const finalId = Number.parseInt(bindId, 10);
      await Promise.all(chunkIds.map((chunkId) => webpackRequire.e(Number(chunkId))));
      loadedModules.push(webpackRequire(finalId));
    }

    // Every other chunk reference in the factory: ensure its chunks, then
    // evaluate each module bound into them.
    const chunkIds = Array.from(
      text.matchAll(new RegExp(CHUNK_ID_SOURCE, "g")),
      (match) => match[1],
    ).filter((chunkId): chunkId is string => chunkId !== undefined);
    if (chunkIds.length === 0) continue;
    const ensured = chunkIds.map((chunkId) => webpackRequire.e(Number(chunkId)));

    for (const [, bindId] of text.matchAll(new RegExp(FINAL_MODULE_ID_SOURCE, "g"))) {
      if (bindId === undefined) continue;
      await Promise.all(ensured);
      loadedModules.push(webpackRequire(Number(bindId)));
    }
  }

  return loadedModules;
}

/**
 * Loads the entry a function's source points at: a
 * `Promise.all([X.e("chunk"), ...]).then(X.bind(X, id))` chain anywhere in
 * the source. Chunks that turn out to be web workers are skipped (loading
 * one would evaluate it in the wrong context).
 *
 * @param source The function (or its source) carrying the lazy entry.
 * @returns The evaluated entry modules, or `null` when none were found.
 */
export async function loadEntry(source: unknown): Promise<unknown[] | null> {
  if (typeof source !== "function" && typeof source !== "string") return null;

  const start = typeof source === "string" ? source : String(source);
  if (!start) return null;

  const stripped = start.replace(WHITESPACE, "");
  const chunks = Array.from(stripped.matchAll(new RegExp(LAZY_CHUNK_SOURCE, "g")));
  if (chunks.length === 0) return null;

  const requires = chunkLoadingRequires();
  const webpackRequire = requires[0];
  if (!webpackRequire) return null;

  const entries: string[] = [];
  const workerCache = new Map<string, boolean>();

  await Promise.all(
    chunks.map(async ([, rawChunkIds, entryPoint]) => {
      if (rawChunkIds === undefined || entryPoint === undefined) return;
      const chunkIds = Array.from(
        rawChunkIds.matchAll(new RegExp(CHUNK_ID_SOURCE, "g")),
        (match) => match[1],
      ).filter((id): id is string => id !== undefined);
      if (chunkIds.length === 0) return;

      await Promise.all(
        chunkIds.map(async (id) => {
          const path = webpackRequire.u(Number(id));
          if (path == null || path.includes("undefined.js")) return;

          try {
            let isWorker = workerCache.get(id);
            if (isWorker === undefined) {
              const text = await fetch(`${webpackRequire.p}${path}`).then((response) =>
                response.text(),
              );
              isWorker = WORKER_CHUNK.test(text);
              workerCache.set(id, isWorker);
            }
            if (isWorker) return;

            await webpackRequire.e(Number(id));
          } catch (error) {
            Logger.error("Webpack~loadEntry", `Failed to load chunk ${id}`, error);
          }
        }),
      );

      if (typeof webpackRequire.m[entryPoint] !== "undefined") {
        webpackRequire(entryPoint);
        entries.push(entryPoint);
      }
    }),
  );

  return entries.map((entry) => webpackRequire(Number(entry)));
}
