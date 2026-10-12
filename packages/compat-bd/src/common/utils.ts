/**
 * BetterDiscord's shared utilities — a port of src/betterdiscord/utils/*
 * (Apache-2.0, see THIRD_PARTY.md): the tree walker, deep extend, debounce,
 * nested access, and the memoizing `cache` (with its lazy `cache.proxy`)
 * behind `BdApi.Utils`. Typed without `any`; the observable semantics are
 * upstream's, quirks included (extend copies inherited enumerable keys, a
 * tree walk may index into primitives, `cache.CALL_LIMIT` resets the memo).
 */

export interface FindInTreeOptions {
  /** Keys that may be walked; `null` (the default) walks every key. */
  walkable?: string[] | null;
  /** Keys to skip — most useful when `walkable` is null. */
  ignore?: string[];
}

/** Key `cache.proxy` exposes its underlying cache under (upstream's choice). */
export const PROXY_CACHE_SYMBOL = Symbol.for("betterdiscord.cache.proxy");

/** A filter for {@link findInTree}: a truthy result matches. */
export type TreeFilter = (value: unknown) => unknown;

/**
 * Finds a value, subobject, or array from a tree that matches a specific
 * filter. This is a DFS.
 *
 * @param tree Tree that should be walked.
 * @param searchFilter Filter to check against each object and subobject, or
 *   a key name to look for directly.
 * @param options Additional options to customize the search.
 * @returns The first match, or `undefined` when the tree holds none.
 */
export function findInTree(
  tree: unknown,
  searchFilter: TreeFilter | string,
  { walkable = null, ignore = [] }: FindInTreeOptions = {},
): unknown {
  if (typeof searchFilter === "string") {
    if (
      tree !== null &&
      tree !== undefined &&
      Object.prototype.hasOwnProperty.call(tree, searchFilter)
    ) {
      return (tree as Record<string, unknown>)[searchFilter];
    }
  } else if (searchFilter(tree)) {
    return tree;
  }

  if (typeof tree !== "object" || tree === null) return undefined;

  let tempReturn: unknown;
  if (Array.isArray(tree)) {
    for (const value of tree) {
      tempReturn = findInTree(value, searchFilter, { walkable, ignore });
      if (tempReturn !== undefined) return tempReturn;
    }
  } else {
    const toWalk = walkable ?? Object.keys(tree);
    for (const key of toWalk) {
      const value = (tree as Record<string, unknown>)[key];
      if (value === undefined || ignore.includes(key)) continue;
      tempReturn = findInTree(value, searchFilter, { walkable, ignore });
      if (tempReturn !== undefined) return tempReturn;
    }
  }
  return tempReturn;
}

function cloneArray(array: readonly unknown[]): unknown[] {
  const clone: unknown[] = [];
  for (let index = 0; index < array.length; index++) {
    const element = array[index];

    if (typeof element !== "object" || element === null) {
      clone[index] = element;
    } else if (Array.isArray(element)) {
      clone[index] = cloneArray(element);
    } else {
      clone[index] = extend({}, element);
    }
  }
  return clone;
}

function shouldSkip(value: unknown): boolean {
  if (typeof value !== "object") return true;
  if (value === null) return true;
  return Array.isArray(value);
}

/**
 * Deep extends an object with a set of other objects. Objects later in the
 * list of `extenders` have priority: primitives are overwritten, and
 * matching object keys are extended recursively. Arrays are deep-cloned.
 *
 * @param target Object to be extended.
 * @param extenders Objects to extend with (at least one).
 * @returns A reference to `target`.
 */
export function extend<T extends object>(target: T, ...extenders: object[]): T {
  if (extenders.length < 1) throw new Error("Needs at least 1 extenders");

  for (const ext of extenders) {
    if (shouldSkip(ext)) continue;

    for (const key in ext) {
      const source = (target as Record<string, unknown>)[key];
      const value = (ext as Record<string, unknown>)[key];

      if (value === target) continue;

      if (typeof value !== "object" || value === null) {
        (target as Record<string, unknown>)[key] = value;
      } else if (Array.isArray(value)) {
        (target as Record<string, unknown>)[key] = cloneArray(value);
      } else if (typeof source !== "object" || source === null || Array.isArray(source)) {
        (target as Record<string, unknown>)[key] = extend({}, value);
      } else {
        (target as Record<string, unknown>)[key] = extend(source, value);
      }
    }
  }

  return target;
}

/**
 * Returns a function that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * `delay` milliseconds (trailing edge).
 *
 * Adapted from the version by David Walsh (https://davidwalsh.name/javascript-debounce-function)
 */
export function debounce<T extends unknown[]>(
  executor: (...args: T) => unknown,
  delay: number,
): (...args: T) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => executor(...args), delay);
  };
}

/**
 * Gets a nested value (if it exists) of an object safely. `path` is
 * `key.key2.key3`; numbers index arrays, e.g. `key.key2.array.0.id`. An
 * empty path returns the object itself; a missing path returns undefined.
 */
export function getNestedProp(object: object, path: string): unknown {
  if (!path) return object;
  const split = path.split(".");
  return split.reduce<unknown>(
    (accumulator, current) => accumulator && (accumulator as Record<string, unknown>)[current],
    object,
  );
}

export interface Cache<T> {
  /** Calls the factory unless a value is cached and the call limit holds. */
  (): T;
  /** Getter form of accessing the data (calls the factory on access). */
  readonly get: T;
  /** Whether a value is currently cached. */
  hasValue(): boolean;
  /** Completely resets the cache factory. */
  reset(): void;
  /** Calls until the cache resets; setting it resets immediately. */
  CALL_LIMIT: number;
}

/**
 * A simple utility for caching a result.
 *
 * @example
 * const foo = cache(() => console.log("Called"));
 * foo(); // LOG: Called
 * foo(); // No log
 */
export function makeCache<T>(factory: () => T): Cache<T> {
  const value: { current?: T; count: number } = { count: 0 };
  let limit = Number.POSITIVE_INFINITY;

  const cacher = (() => {
    if (value.count++ > limit - 1) cacher.reset();
    if ("current" in value) return value.current;

    const current = factory();
    value.current = current;
    return current;
  }) as Cache<T>;

  cacher.hasValue = () => "current" in value;

  cacher.reset = () => {
    delete value.current;
    value.count = 0;
  };

  Object.defineProperty(cacher, "CALL_LIMIT", {
    get: () => limit,
    set: (next: unknown) => {
      if (
        typeof next !== "number" ||
        Number.isNaN(next) ||
        next <= 0 ||
        Math.round(next) !== next
      ) {
        throw new Error("Unable to set max call threshold. Value is not a positive int");
      }
      limit = next;
      cacher.reset();
    },
  });

  Object.defineProperty(cacher, "get", {
    get: () => cacher(),
  });

  return cacher;
}

/**
 * Like {@link makeCache} but the factory runs on first property access
 * instead of on an explicit call, through a proxy over the eventual value.
 */
export function proxyCache<T extends object>(
  factory: () => T,
  typeofIsObject = false,
  callLimit = Number.POSITIVE_INFINITY,
): T {
  const cFactory = makeCache(factory);
  cFactory.CALL_LIMIT = callLimit;

  const cacheFactory = (): T => {
    if (!cFactory.hasValue()) return cFactory();
    const cached = cFactory();
    if (cached instanceof Object) return cached;
    // Attempt to hopefully have the results be an instance of Object.
    cFactory.reset();
    return cFactory();
  };

  const handlers: ProxyHandler<T> = {
    get: (_target, property, receiver) => {
      if (property === "prototype") {
        return (cacheFactory() as { prototype?: unknown }).prototype ?? Function.prototype;
      }
      if (property === PROXY_CACHE_SYMBOL) return cFactory;
      return Reflect.get(cacheFactory(), property, receiver);
    },
    ownKeys: () => {
      const keys = Reflect.ownKeys(cacheFactory());
      if (!typeofIsObject && !keys.includes("prototype")) keys.push("prototype");
      return keys;
    },
    apply: (_target, thisArgument, argumentsList) =>
      Reflect.apply(cacheFactory() as (...args: unknown[]) => unknown, thisArgument, argumentsList),
    construct: (_target, argumentsList, newTarget) =>
      Reflect.construct(
        cacheFactory() as new (...args: unknown[]) => object,
        argumentsList,
        newTarget,
      ) as object,
    has: (_target, property) => Reflect.has(cacheFactory(), property),
    set: (_target, property, value, receiver) =>
      Reflect.set(cacheFactory(), property, value, receiver),
    deleteProperty: (_target, property) => Reflect.deleteProperty(cacheFactory(), property),
    defineProperty: (_target, property, descriptor) =>
      Reflect.defineProperty(cacheFactory(), property, descriptor),
    getOwnPropertyDescriptor: (_target, property) =>
      Reflect.getOwnPropertyDescriptor(cacheFactory(), property) ?? undefined,
    getPrototypeOf: () => Reflect.getPrototypeOf(cacheFactory()),
    setPrototypeOf: (_target, prototype) => Reflect.setPrototypeOf(cacheFactory(), prototype),
    isExtensible: () => Reflect.isExtensible(cacheFactory()),
    preventExtensions: () => Reflect.preventExtensions(cacheFactory()),
  };

  const target = typeofIsObject ? {} : () => undefined;
  Object.defineProperty(target, PROXY_CACHE_SYMBOL, { value: cFactory });
  return new Proxy(target as unknown as T, handlers);
}

export const cache = Object.assign(makeCache, { proxy: proxyCache });
