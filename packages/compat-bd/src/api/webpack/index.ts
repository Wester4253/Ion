/**
 * `BdApi.Webpack` — BetterDiscord's webpack-module facade. Behavioral port
 * of BetterDiscord's src/betterdiscord/api/webpack.ts (Apache-2.0, see
 * THIRD_PARTY.md): the same filters, the same option validation messages,
 * and the same search semantics — reached through the module caches the
 * Ion core captured from Discord's bundler runtimes.
 */

import { Logger } from "../../common/logger";
import {
  byComponentType,
  byDisplayName,
  byKeys,
  byPrototypeKeys,
  byRegex,
  bySource,
  byStoreName,
  byStrings,
  combine,
  not,
} from "./filters";
import { modules, Stores, getMangledProxy, getProxy } from "./proxies";
import {
  getAllModules,
  getById,
  getBulk,
  getBulkKeyed,
  getMangled,
  getModule,
  getStore,
  getWithKey,
  waitForModule,
} from "./search";
import type {
  BulkQueries,
  ExportedOnlyFilter,
  LazyOptions,
  MangledFilter,
  ModuleFilter,
  ProxyOptions,
  SearchOptions,
  WebpackOptions,
  WithKeyOptions,
} from "./types";

/** Trailing-options form: `byKeys("foo", "bar", {first: false})`. */
type WithOptions<T> = [...T[], WebpackOptions] | T[];

function getOptions<T>(args: readonly unknown[]): [T[], WebpackOptions] {
  const rest = [...args];
  const options: WebpackOptions = {};
  if (
    rest.length > 1 &&
    typeof rest[rest.length - 1] === "object" &&
    !Array.isArray(rest[rest.length - 1]) &&
    rest[rest.length - 1] !== null
  ) {
    Object.assign(options, rest.pop());
  }
  return [rest as T[], options];
}

function invalidOption(
  method: string,
  name: string,
  value: unknown,
  expected = "Expected: boolean",
): undefined {
  Logger.error(`BdApi.Webpack~${method}`, `Invalid type for options.${name}`, value, expected);
}

/** BD validates each method's own option list; a bad one logs and returns undefined. */
function rejectInvalid(
  method: string,
  options: SearchOptions,
  names: readonly (keyof SearchOptions)[],
): boolean {
  for (const name of names) {
    if (name in options && typeof options[name] !== "boolean") {
      invalidOption(method, name, options[name]);
      return true;
    }
  }
  return false;
}

function moduleWithFirst<T>(filter: ModuleFilter, options: WebpackOptions): T | T[] {
  if (options.first === false) return getAllModules(filter, options) as T[];
  return getModule(filter, options) as T;
}

/**
 * A utility for finding webpack modules — the workhorse every BetterDiscord
 * plugin is written against.
 */
export class Webpack {
  /** A Proxy that returns the module source by ID. */
  readonly modules = modules;
  /** A lazy Proxy of Discord's internal Flux stores, by store name. */
  readonly Stores = Stores;
  /** Series of filters to be used for finding webpack modules. */
  readonly Filters = {
    /** Search for modules with all the given properties. */
    byKeys: (...keys: string[]): ExportedOnlyFilter => byKeys(keys),
    /** Search for modules whose prototype has all the given fields. */
    byPrototypeKeys: (...fields: string[]): ExportedOnlyFilter => byPrototypeKeys(fields),
    /** Search modules whose source string matches a regex. */
    byRegex: (regex: RegExp): ExportedOnlyFilter => byRegex(regex),
    /** Search modules whose factory source matches every string/regex. */
    bySource: (...searches: (string | RegExp)[]): ModuleFilter => bySource(...searches),
    /** Search function exports whose source contains every string. */
    byStrings: (...strings: string[]): ExportedOnlyFilter => byStrings(...strings),
    /** Search modules with the given `displayName`. */
    byDisplayName: (name: string): ExportedOnlyFilter => byDisplayName(name),
    /** Search Flux stores by their registered name. */
    byStoreName: (name: string): ExportedOnlyFilter => byStoreName(name),
    /** Search for React components by their resolved type. */
    byComponentType: (filter: ExportedOnlyFilter): ExportedOnlyFilter => byComponentType(filter),
    /** Combine filters: the result matches only when every filter matches. */
    combine: (...filters: ModuleFilter[]): ModuleFilter => combine(...filters),
    /** Invert a filter. */
    not: (filter: ModuleFilter): ModuleFilter => not(filter),
  };

  /** Deprecated: yields the export holder, then the matching key. */
  getWithKey(filter: ExportedOnlyFilter, options: WithKeyOptions = {}) {
    if ("first" in options) {
      Logger.error("BdApi.Webpack~getWithKey", "Unsupported option first.");
      return;
    }
    if (rejectInvalid("getWithKey", options, ["defaultExport", "searchExports", "raw"]))
      return undefined;
    return getWithKey(filter, options);
  }

  /** Find the first module matching a filter. */
  getModule<T>(filter: ModuleFilter, options: WebpackOptions = {}): T | T[] | undefined {
    // Upstream logs `~get` here — kept verbatim so messages match BetterDiscord.
    if ("first" in options && typeof options.first !== "boolean") {
      invalidOption("get", "first", options.first);
      return;
    }
    if (rejectInvalid("getModule", options, ["defaultExport", "searchExports", "raw", "fatal"])) {
      return undefined;
    }
    return moduleWithFirst<T>(filter, options);
  }

  /** Find every module matching a filter. */
  getModules<T>(filter: ModuleFilter, options: WebpackOptions = {}): T[] {
    if (rejectInvalid("getModules", options, ["defaultExport", "searchExports", "raw"])) return [];
    return getAllModules(filter, options) as T[];
  }

  /** Run several queries in one cache pass. */
  getBulk(...queries: BulkQueries[]): unknown[] {
    return getBulk(queries);
  }

  /** Like {@link getBulk}, but results are keyed by query object key. */
  getBulkKeyed<T extends object>(queries: Record<keyof T, BulkQueries>): T {
    return getBulkKeyed<T>(queries);
  }

  /** Wait for the first module matching a filter — now or later. */
  waitForModule<T>(
    filter: ModuleFilter,
    options: LazyOptions = {},
  ): Promise<T | undefined> | undefined {
    if ("defaultExport" in options && typeof options.defaultExport !== "boolean") {
      invalidOption("waitForModule", "defaultExport", options.defaultExport);
      return;
    }
    if ("signal" in options && !(options.signal instanceof AbortSignal)) {
      invalidOption("waitForModule", "signal", options.signal, "AbortSignal expected.");
      return;
    }
    if (rejectInvalid("waitForModule", options, ["searchExports", "raw", "fatal"]))
      return undefined;
    return waitForModule<T>(filter, options);
  }

  /** Find the first module whose source matches a regex. */
  getByRegex<T>(regex: RegExp, options: WebpackOptions = {}): T | T[] | undefined {
    return moduleWithFirst<T>(byRegex(regex), options);
  }

  /** Find every module whose source matches a regex. */
  getAllByRegex<T>(regex: RegExp, options: WebpackOptions = {}): T[] {
    return getAllModules(byRegex(regex), options) as T[];
  }

  /** Find the first mangled-export object matching mappers. */
  getMangled<T extends object>(
    filter: MangledFilter,
    mangled: Record<keyof T, ExportedOnlyFilter>,
    options: WebpackOptions = {},
  ): T {
    if (rejectInvalid("getMangled", options, ["defaultExport", "searchExports", "raw", "fatal"])) {
      return {} as T;
    }
    return getMangled<T>(filter, mangled, options);
  }

  /** Find a module by prototype fields. */
  getByPrototypeKeys<T>(...prototypes: WithOptions<string>): T | T[] | undefined {
    const [fields, options] = getOptions<string>(prototypes);
    return moduleWithFirst<T>(byPrototypeKeys(fields), options);
  }

  /** Find every module by prototype fields. */
  getAllByPrototypeKeys<T>(...prototypes: WithOptions<string>): T[] {
    const [fields, options] = getOptions<string>(prototypes);
    return getAllModules(byPrototypeKeys(fields), options) as T[];
  }

  /** Find a module exposing all the given properties. */
  getByKeys<T>(...props: WithOptions<string>): T | T[] | undefined {
    const [keys, options] = getOptions<string>(props);
    return moduleWithFirst<T>(byKeys(keys), options);
  }

  /** Find every module exposing all the given properties. */
  getAllByKeys<T>(...props: WithOptions<string>): T[] {
    const [keys, options] = getOptions<string>(props);
    return getAllModules(byKeys(keys), options) as T[];
  }

  /** Find a module whose source contains all the given strings. */
  getByStrings<T>(...strings: WithOptions<string>): T | T[] | undefined {
    const [searches, options] = getOptions<string>(strings);
    return moduleWithFirst<T>(byStrings(...searches), options);
  }

  /** Find every module whose source contains all the given strings. */
  getAllByStrings<T>(...strings: WithOptions<string>): T[] {
    const [searches, options] = getOptions<string>(strings);
    return getAllModules(byStrings(...searches), options) as T[];
  }

  /** Find a module whose factory source matches every search. */
  getBySource<T>(...searches: WithOptions<string | RegExp>): T | T[] | undefined {
    const [terms, options] = getOptions<string | RegExp>(searches);
    return moduleWithFirst<T>(bySource(...terms), options);
  }

  /** Find every module whose factory source matches every search. */
  getAllBySource<T>(...searches: WithOptions<string | RegExp>): T[] {
    const [terms, options] = getOptions<string | RegExp>(searches);
    return getAllModules(bySource(...terms), options) as T[];
  }

  /** Find a Flux store by name. */
  getStore(name: string): unknown {
    return getStore(name);
  }

  /** Find a module record by id. */
  getById(id: PropertyKey, options: SearchOptions = {}): unknown {
    if (rejectInvalid("getById", options, ["raw", "fatal"])) return undefined;
    return getById(id, options);
  }

  /** Lazy proxy that resolves the module on first property access. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callers name the module shape, exactly as BetterDiscord's `getProxy<T>` does.
  getProxy<T extends object>(filter: ModuleFilter, options: ProxyOptions = {}): T | undefined {
    if (rejectInvalid("getProxy", options, ["defaultExport", "searchExports", "raw", "fatal"])) {
      return undefined;
    }
    return getProxy(filter, options) as T | undefined;
  }

  /** Lazy proxy over {@link getMangled}. */
  getMangledProxy<T extends object>(
    filter: MangledFilter,
    mangled: Record<keyof T, ExportedOnlyFilter>,
    options: WebpackOptions = {},
  ): T {
    if (
      rejectInvalid("getMangledProxy", options, ["defaultExport", "searchExports", "raw", "fatal"])
    ) {
      return {} as T;
    }
    return getMangledProxy<T>(filter, mangled, options);
  }
}

Object.freeze(Webpack);
Object.freeze(Webpack.prototype);
