/**
 * The `@webpack` shim — Ion's answer to Vencord's webpack module.
 *
 * Every vendored Vencord source resolves `@webpack` to this file. Instead of
 * Vencord's own chunk hook (which Ion replaces wholesale), every function
 * delegates to `window.__ION__.discovery`, the core's public discovery API,
 * and layers Vencord's extra sugar on top: mangled-module mapping, CSS
 * class mapping, lazy component helpers, and the `wreq` require wrapper.
 *
 * Semantics mirror upstream's `src/webpack/webpack.ts` (vendored copy in
 * vendor/vencord) one-to-one where the closure of the acceptance set uses
 * them; see THIRD_PARTY.md for attribution.
 */

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";
import { Logger } from "@utils/Logger";
import { makeLazy } from "@utils/lazy";
import { LazyComponent } from "@utils/lazyReact";
import { canonicalizeMatch } from "@utils/patches";

const logger = new Logger("Webpack");

export type FilterFn = (mod: unknown) => boolean;
export type PropsFilter = string[];
export type CodeFilter = (string | RegExp)[];
export type StoreNameFilter = string;
export type CallbackFn = (module: unknown, id: PropertyKey) => void;

function discovery(): IonDiscoveryApi {
  const api = (window as Window & { __ION__?: IonGlobal }).__ION__?.discovery;
  if (!api) {
    throw new Error("compat-vencord loaded before the Ion core: window.__ION__.discovery missing");
  }
  return api;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match a CSS class name as Discord writes it: `hash_name_abc123`. */
export function makeClassNameRegex(className: string): RegExp {
  return new RegExp(`(?<=^|\\s)${escapeRegExp(className)}(?:_\\S*)?(?=$|\\s)`);
}

export const stringMatches = (source: string, filter: CodeFilter): boolean =>
  filter.every((fragment) => {
    if (typeof fragment === "string") return source.includes(fragment);
    if (fragment.global || fragment.sticky) fragment.lastIndex = 0;
    return fragment.test(source);
  });

export const filters = {
  byProps:
    (...props: PropsFilter): FilterFn =>
    (mod: unknown): boolean => {
      if (typeof mod !== "object" && typeof mod !== "function") return false;
      if (mod == null) return false;
      const record = mod as Record<string, unknown>;
      return props.every((prop) => record[prop] !== undefined);
    },

  byCode:
    (...code: CodeFilter): FilterFn =>
    (mod: unknown): boolean => {
      if (typeof mod !== "function") return false;
      const parsedCode = code.map(canonicalizeMatch);
      return stringMatches(Function.prototype.toString.call(mod), parsedCode);
    },

  byStoreName:
    (name: StoreNameFilter): FilterFn =>
    (mod: unknown): boolean =>
      (mod as { constructor?: { displayName?: string } } | null)?.constructor?.displayName === name,

  componentByCode: (...code: CodeFilter): FilterFn => {
    const byCodeFilter = filters.byCode(...code);
    return (mod: unknown): boolean => {
      let inner: unknown = mod;
      while (inner != null) {
        if (byCodeFilter(inner)) return true;
        const node = inner as { $$typeof?: unknown; type?: unknown; render?: unknown };
        if (!node.$$typeof) return false;
        else if (node.type)
          inner = node.type; // memos
        else if (node.render)
          inner = node.render; // forwardRefs
        else return false;
      }
      return false;
    };
  },

  byClassNames: (...classes: string[]): FilterFn => {
    const regexes = classes.map(makeClassNameRegex);
    return (mod: unknown): boolean => {
      if (typeof mod !== "object" || mod == null) return false;
      const values = Object.values(mod);
      return regexes.every((cls) => values.some((v) => typeof v === "string" && cls.test(v)));
    };
  },
};

function handleModuleNotFound(method: string, ...filter: unknown[]): void {
  logger.warn(`${method}: Could not find module with filter ${JSON.stringify(filter, replacer)}`);
}

function replacer(_key: string, value: unknown): unknown {
  return value instanceof RegExp ? value.toString() : value;
}

export function find(filter: FilterFn, options?: { topLevelOnly?: boolean }): unknown {
  return discovery().find(filter, options);
}

export function findAll(filter: FilterFn, options?: { topLevelOnly?: boolean }): unknown[] {
  return discovery().findAll(filter, options);
}

/**
 * Resolve several filters in one pass, returning the first match per filter.
 * Ion's discovery is per-filter, so this loops — same results, one cache
 * scan per filter.
 */
export function findBulk(...filterFns: FilterFn[]): unknown[] {
  if (filterFns.length === 0) throw new Error("findBulk: expected at least one filter");
  return filterFns.map((filter, index) => {
    const result = find(filter);
    if (result === undefined) {
      logger.warn("findBulk: only found", index, "of", filterFns.length, "modules");
    }
    return result;
  });
}

export function findByProps(...props: PropsFilter): unknown {
  const res = find(filters.byProps(...props));
  if (res === undefined) handleModuleNotFound("findByProps", ...props);
  return res;
}

export function findByPropsLazy(...props: PropsFilter): unknown {
  return proxyLazyWebpack(() => findByProps(...props));
}

export function findByCode(...code: CodeFilter): unknown {
  const res = find(filters.byCode(...code));
  if (res === undefined) handleModuleNotFound("findByCode", ...code);
  return res;
}

export function findByCodeLazy(...code: CodeFilter): unknown {
  return proxyLazyWebpack(() => findByCode(...code));
}

interface FluxModuleLike {
  readonly Store?: {
    readonly getAll?: () => readonly { getName(): string }[];
  };
}

/**
 * Upstream's flux store registry, keyed by display name, populated the way
 * upstream populates it: a bulk `Flux.Store.getAll()` seeded on the first
 * lookup miss, then a write on every successful `findStore`. This is what
 * consoleShortcuts' store listing reads back. Upstream also folds libdiscore's
 * wasm stores into the seed; those are left to the regular by-name cache scan
 * here instead (a `findByCode` probe would log a miss warning on Discord
 * builds that don't ship them).
 */
export const fluxStores = new Map<string, unknown>();
let fluxStoresPopulated = false;

function populateFluxStoreMap(): void {
  if (fluxStoresPopulated) return;
  const flux = find(filters.byProps("connectStores")) as FluxModuleLike | undefined;
  if (flux == null) return; // Discord's Flux has not loaded yet — retry on the next miss.
  fluxStoresPopulated = true;
  const stores = flux.Store?.getAll?.() ?? [];
  for (const store of stores) {
    fluxStores.set(store.getName(), store);
  }
}

export function findStore(name: StoreNameFilter): unknown {
  if (!fluxStores.has(name)) populateFluxStoreMap();
  const seeded = fluxStores.get(name);
  if (seeded !== undefined) return seeded;

  const res = find(filters.byStoreName(name));
  if (res === undefined) {
    handleModuleNotFound("findStore", name);
    return undefined;
  }
  fluxStores.set(name, res);
  return res;
}

export function findStoreLazy(name: StoreNameFilter): unknown {
  return proxyLazyWebpack(() => findStore(name));
}

export function findComponentByCode(...code: CodeFilter): unknown {
  const res = find(filters.componentByCode(...code));
  if (res === undefined) handleModuleNotFound("findComponentByCode", ...code);
  return res;
}

/**
 * Lazy `findComponentByCode`. Upstream exposes a type parameter here; the
 * adapter's own sources never instantiate it and the vendored tree is not
 * typechecked, so the return stays `unknown`.
 */
export function findComponentByCodeLazy(...code: CodeFilter): unknown {
  return LazyComponent(() => findComponentByCode(...code));
}

/** Upstream's `findComponentLazy`: the first component match, on demand. */
export function findComponentLazy(filter: FilterFn): unknown {
  return LazyComponent(() => find(filter));
}

export function findLazy(filter: FilterFn): unknown {
  return proxyLazyWebpack(() => find(filter));
}

export function findModuleId(...code: CodeFilter): string | null {
  return discovery().findModuleId(...code);
}

export function findModuleFactory(...code: CodeFilter): unknown {
  const id = findModuleId(...code);
  if (!id) return null;
  for (const req of discovery().getRequires()) {
    const factory = req.m[id];
    if (factory) return factory;
  }
  return null;
}

export function search(...code: CodeFilter): Record<string, unknown> {
  return discovery().search(...code);
}

/**
 * Upstream's `extract`: re-evaluate one module factory under a `sourceURL`
 * so devtools lists it as a standalone, readable file. Debug-only — it backs
 * consoleShortcuts' `wpex`/`wpexs`, and like upstream the extracted copy is
 * never installed as a module (breakpoints in it do nothing, which the
 * injected banner says out loud).
 */
export function extract(moduleId: PropertyKey): unknown {
  const originalFactory = wreq.m[moduleId];
  if (typeof originalFactory !== "function") return null;
  const code = String(originalFactory);
  const isArrowFunction = code.startsWith("(");
  const wrapped = "0," + (!isArrowFunction ? "function" : "") + code.slice(code.indexOf("("));
  const source = `// [EXTRACTED] WebpackModule${String(moduleId)}
// WARNING: This module was extracted to be more easily readable.
//          This module is NOT ACTUALLY USED! This means putting breakpoints will have NO EFFECT!!

0,${wrapped}
//# sourceURL=file:///ExtractedWebpackModule${String(moduleId)}`;
  return (0, eval)(source) as unknown;
}

export function waitFor(filter: FilterFn | readonly string[], listener: CallbackFn): () => void {
  return discovery().waitFor(filter, listener);
}

export function mapMangledCssClasses<S extends string>(
  mappedModule: object,
  classes: readonly S[],
): Record<S, string> {
  const values: readonly unknown[] = Object.values(mappedModule);
  const mapped = {} as Record<S, string>;

  for (const cls of classes) {
    const regex = makeClassNameRegex(cls);
    const value = values.find((v): v is string => typeof v === "string" && regex.test(v));
    if (value === undefined) {
      throw new Error(`mapMangledCssClasses: ${cls} not found in module`);
    }
    mapped[cls] = value;
  }

  return mapped;
}

export function findCssClasses<S extends string>(...classes: S[]): Record<S, string> {
  const res = find(filters.byClassNames(...classes), { topLevelOnly: true });
  if (res == null) {
    handleModuleNotFound("findCssClasses", ...classes);
    return {} as Record<S, string>;
  }
  return mapMangledCssClasses(res, classes);
}

export function findCssClassesLazy<S extends string>(...classes: S[]): Record<S, string> {
  return proxyLazyWebpack(() => findCssClasses(...classes));
}

function getAllPropertyNames(object: object): string[] {
  const names = new Set<string>();
  let current: object | null = object;
  do {
    for (const name of Object.keys(current)) {
      if (name !== "__esModule") names.add(name);
    }
    // getPrototypeOf is typed as returning any; step through unknown.
    const prototype: unknown = Object.getPrototypeOf(current);
    current = prototype as object | null;
  } while (current != null);
  return [...names];
}

/**
 * Find a mangled module by code and map its exports to readable names via
 * per-export filters.
 */
export function mapMangledModule<S extends string>(
  code: string | RegExp | CodeFilter,
  mappers: Record<S, FilterFn>,
): Record<S, unknown> {
  const exports = {} as Record<S, unknown>;
  const id = findModuleId(...(Array.isArray(code) ? code : [code]));
  if (id === null) return exports;

  const mod = wreq(id) as object | undefined;
  if (mod == null) return exports;

  outer: for (const key of getAllPropertyNames(mod)) {
    const member = (mod as Record<string, unknown>)[key];
    for (const newName in mappers) {
      if (mappers[newName](member)) {
        exports[newName] = member;
        continue outer;
      }
    }
  }
  return exports;
}

export function mapMangledModuleLazy<S extends string>(
  code: string | RegExp | CodeFilter,
  mappers: Record<S, FilterFn>,
): Record<S, unknown> {
  return proxyLazyWebpack(() => mapMangledModule(code, mappers));
}

// Upstream's reporter records lazy finds for its test harness; Ion's
// harness reads the core's own patch/lookups telemetry instead, so this
// stays an empty, shape-compatible list.
export const lazyWebpackSearchHistory: unknown[] = [];

export function proxyLazyWebpack<T>(factory: () => T, attempts?: number): T {
  return discovery().proxyLazy(factory, attempts);
}

export function LazyComponentWebpack(factory: () => unknown, attempts?: number): unknown {
  return LazyComponent(factory, attempts);
}

/** Upstream's default matcher over a lazy-chunk-loading module factory. */
export const DefaultExtractAndLoadChunksRegex =
  /(?:(?:Promise\.all\(\[)?((?:\i\.e\("?[^)]+?"?\),?)+?)(?:\]\))?|Promise\.resolve\(\))\.then\(\i\.bind\(\i,"?([^)]+?)"?\)\)/;
export const ChunkIdsRegex = /\("([^"]+?)"\)/g;

/**
 * Find the module factory containing a lazy chunk load, extract its chunk
 * ids, ensure them through `wreq.e`, then evaluate the entry point —
 * upstream's `extractAndLoadChunks`, minus the dev-build strictness (this
 * build sets IS_DEV false, so failures warn and resolve false).
 */
export async function extractAndLoadChunks(
  code: CodeFilter,
  matcher: RegExp = DefaultExtractAndLoadChunksRegex,
): Promise<boolean> {
  const factory = findModuleFactory(...code);
  if (factory == null) {
    logger.warn("extractAndLoadChunks: Couldn't find module factory", code, matcher);
    return false;
  }
  if (typeof factory !== "function") {
    logger.warn("extractAndLoadChunks: matched module is not a factory function", code);
    return false;
  }

  const match = String(factory).match(canonicalizeMatch(matcher));
  if (!match) {
    logger.warn("extractAndLoadChunks: Couldn't find chunk loading in module factory code", code);
    return false;
  }

  const [, rawChunkIds, entryPointId] = match;
  if (entryPointId == null) {
    logger.warn("extractAndLoadChunks: Matcher returned no entry point id", code, matcher);
    return false;
  }

  const numericEntryPoint = Number(entryPointId);
  const entryPoint = Number.isNaN(numericEntryPoint) ? entryPointId : String(numericEntryPoint);

  if (rawChunkIds) {
    const chunkIds = [...rawChunkIds.matchAll(ChunkIdsRegex)].flatMap((found) => {
      const raw = found[1];
      if (raw === undefined) return [];
      const numericChunkId = Number(raw);
      return [Number.isNaN(numericChunkId) ? raw : String(numericChunkId)];
    });
    await Promise.all(chunkIds.map((id) => wreq.e(id)));
  }

  if (wreq.m[entryPoint] == null) {
    logger.warn(
      "extractAndLoadChunks: entry point not in the factories, perhaps a chunk failed to load",
      entryPoint,
    );
    return false;
  }

  wreq(entryPoint);
  return true;
}

/** `extractAndLoadChunks`, retried lazily; see upstream's makeLazy. */
export function extractAndLoadChunksLazy(
  code: CodeFilter,
  matcher: RegExp = DefaultExtractAndLoadChunksRegex,
): () => Promise<boolean> {
  return makeLazy(() => extractAndLoadChunks(code, matcher));
}

interface WreqLike {
  (id: PropertyKey): unknown;
  readonly c: Record<PropertyKey, unknown>;
  readonly m: Record<PropertyKey, unknown>;
  /** `__webpack_require__.e`: ensure a lazy chunk is loaded. */
  e(id: string): Promise<unknown>;
}

/**
 * Upstream's `__webpack_require__`. Ion captures one require per bundler
 * runtime; this wrapper serves a module id from whichever runtime has it
 * evaluated, falling back to the first captured runtime.
 */
export const wreq = ((id: PropertyKey) => {
  const requires = discovery().getRequires();
  for (const req of requires) {
    if (req.c[id] !== undefined) return req(id);
  }
  const primary = requires[0];
  if (!primary) throw new Error(`wreq: webpack has not started yet (module ${String(id)})`);
  return primary(id);
}) as WreqLike;

/** The captured `__webpack_require__`, plus chunk loading (`e`). */
interface ChunkRequire {
  (id: PropertyKey): unknown;
  readonly c: Record<PropertyKey, unknown>;
  readonly m: Record<PropertyKey, unknown>;
  e?(id: string): Promise<unknown>;
}

function requireWithChunkLoading(): ChunkRequire | undefined {
  // Core types only `c` and `m`; the captured objects are webpack's full
  // `__webpack_require__`, so `e` is probed structurally.
  return (discovery().getRequires() as readonly ChunkRequire[]).find(
    (req) => typeof req.e === "function",
  );
}

Object.defineProperty(wreq, "c", {
  get: () => discovery().getRequires()[0]?.c ?? {},
});
Object.defineProperty(wreq, "m", {
  get: () => discovery().getRequires()[0]?.m ?? {},
});
Object.defineProperty(wreq, "e", {
  value: (id: string) => {
    const req = requireWithChunkLoading();
    if (!req?.e) {
      return Promise.reject(new Error(`wreq.e: webpack has not started yet (chunk ${id})`));
    }
    // Bound to its runtime: some webpack builds read `this` in `e`.
    return req.e.call(req, id);
  },
});

/**
 * Upstream's `cache`: the primary runtime's module cache (`wreq.c`).
 * Upstream assigns it once its chunk hook initializes; Ion captures requires
 * as chunks arrive, so this is a live forwarding view — reads always hit the
 * current primary cache instead of a snapshot from bundle load. It backs
 * consoleShortcuts' `wpc` console helper.
 */
export const cache: Record<PropertyKey, unknown> = new Proxy<Record<PropertyKey, unknown>>(
  {},
  {
    get: (_target, property) => Reflect.get(wreq.c, property),
    has: (_target, property) => Reflect.has(wreq.c, property),
    ownKeys: () => Reflect.ownKeys(wreq.c),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(wreq.c, property);
      if (descriptor == null) return undefined;
      // The proxy target stays empty, so every reported property must be
      // configurable to satisfy the proxy invariants.
      return { ...descriptor, configurable: true };
    },
  },
);

/**
 * Upstream notifies these as webpack registers module factories, from its own
 * chunk hook. Ion's chunk hook lives in core (it wraps factories for patching
 * but does not fan out to the page), and the only upstream consumer —
 * `loadLazyChunks` — is gated behind `IS_DEV` in both projects, so a
 * production build never has a subscriber. Exported as a real Set so the
 * vendored debug helper binds to something instead of `undefined`.
 */
export type FactoryListener = (factory: unknown, moduleId: PropertyKey) => void;
export const factoryListeners = new Set<FactoryListener>();

let resolveReady!: () => void;
/** Upstream resolves its webpack-ready promise when the gateway connects. */
export const onceReady = new Promise<void>((resolve) => {
  resolveReady = resolve;
});
discovery()
  .onceReady.then(resolveReady)
  .catch(() => undefined);

/**
 * Called by the vendored common modules when they consider webpack ready.
 * Stage gating belongs to the Ion host (`startAt` on each translated
 * plugin), so this only settles the upstream-shaped promise.
 */
export const _resolveReady = (): void => {
  resolveReady();
};
