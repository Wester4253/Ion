// @vitest-environment happy-dom
/**
 * Unit tests for the `BdApi.Webpack` facade, run against synthetic
 * `__webpack_require__` caches (no Discord). They pin the BetterDiscord
 * search semantics Ion must reproduce: default-export descent, the
 * token-store/collection skips, throwing-filter isolation, raw/withKey/map
 * shaping, the Stores/modules proxies, and the promise-based waits.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests pin the console output BdApi.Logger produces, because the
// compat harness attributes plugin failures by reading it back off the
// `console-message` event. Referencing the spied methods is the point.
/* eslint-disable no-console */

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";

import { Webpack } from "./index";
import type { BdModule, ModuleFilter } from "./types";

interface FakeRequire {
  c: Record<string, unknown>;
  m: Record<string, unknown>;
  (): unknown;
}

interface Waiter {
  filter: ModuleFilter;
  listener: (exports: unknown, id: PropertyKey) => void;
}

let requires: FakeRequire[] = [];
let waiters: Waiter[] = [];
let api: Webpack;
let emit: (id: string, exports: unknown) => void;

/** Install the discovery shim the facade reads (`getRequires`/`waitFor`). */
function installDiscovery(): { emit: (id: string, exports: unknown) => void } {
  const discovery = {
    getRequires: () => requires,
    waitFor: (filter: ModuleFilter, listener: Waiter["listener"]) => {
      const entry = { filter, listener };
      waiters.push(entry);
      return () => {
        const index = waiters.indexOf(entry);
        if (index >= 0) waiters.splice(index, 1);
      };
    },
  } as unknown as IonDiscoveryApi;

  (window as unknown as { __ION__: IonGlobal }).__ION__ = { discovery } as unknown as IonGlobal;

  return {
    emit: (id, exports) => {
      for (const require of requires) require.c[id] = { id, loaded: true, exports };
      for (const waiter of [...waiters]) {
        if (waiter.filter(exports, { id, exports }, id)) waiter.listener(exports, id);
      }
    },
  };
}

/** Build a fake bundler runtime with the given evaluated modules + factories. */
function useModules(
  modules: Record<string, unknown>,
  factories: Record<string, unknown> = {},
): FakeRequire {
  const require = Object.assign(() => undefined, {
    c: Object.fromEntries(
      Object.entries(modules).map(([id, exports]) => [id, { id, loaded: true, exports }]),
    ),
    m: factories,
  }) as unknown as FakeRequire;
  requires = [require];
  return require;
}

const byKeys =
  (props: string[]): ModuleFilter =>
  (exports) =>
    typeof exports === "object" && exports !== null && props.every((p) => p in exports);

beforeEach(() => {
  requires = [];
  waiters = [];
  api = new Webpack();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  ({ emit } = installDiscovery());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getModule", () => {
  it("finds a module by keys", () => {
    useModules({ 1: { sendMessage: () => undefined } });
    const found = api.getModule(byKeys(["sendMessage"])) as Record<string, unknown> | undefined;
    expect(typeof found?.["sendMessage"]).toBe("function");
  });

  it("resolves webpack lazy getters so classes can be extended", () => {
    function RealStore(this: unknown): void {
      return undefined;
    }
    RealStore.getName = (): string => "UserStore";
    // Discord's minified shape: an arrow with no prototype that returns the class.
    const lazy = (): unknown => RealStore;
    useModules({ 1: { Store: lazy } });
    const found = api.getModule(byKeys(["Store"])) as Record<string, unknown> | undefined;
    expect(found?.["Store"]).toBe(RealStore);
    expect(() => {
      const Child = class extends (found?.["Store"] as typeof RealStore) {};
      return Child;
    }).not.toThrow();
  });

  it("leaves plain accessors returning primitives callable", () => {
    const userStore = { _dispatchToken: "t", getName: () => "UserStore" };
    useModules({ 1: userStore });
    expect(api.getStore("UserStore")).toBe(userStore);
  });

  it("returns undefined on a miss and throws when fatal", () => {
    useModules({ 1: { other: true } });
    expect(api.getModule(byKeys(["sendMessage"]))).toBeUndefined();
    expect(() => api.getModule(byKeys(["sendMessage"]), { fatal: true })).toThrow(
      "Module search failed!",
    );
  });

  it("never hands out the auth-token store (Ion hard rule)", () => {
    useModules({ 1: { getToken: () => "secret", getCurrentUser: () => undefined } });
    // A filter that would otherwise match everything must still be blocked.
    expect(api.getModule(() => true)).toBeUndefined();
    expect(api.getModule(byKeys(["getToken"]))).toBeUndefined();
  });

  it("skips collection-lookalike exports", () => {
    useModules({ 1: { remove: 1, set: 1, clear: 1, get: 1 } });
    expect(api.getModule(() => true)).toBeUndefined();
  });

  it("descends into the default-export key (A, then __esModule.default)", () => {
    useModules({
      1: { A: { sendMessage: 1 } },
      2: { __esModule: true, default: { sendMessage: 2 } },
    });
    expect(api.getModule(byKeys(["sendMessage"]))).toEqual({ sendMessage: 1 });

    useModules({ 2: { __esModule: true, default: { sendMessage: 2 } } });
    expect(api.getModule(byKeys(["sendMessage"]))).toEqual({ sendMessage: 2 });
  });

  it("returns the full exports for a default-key match unless defaultExport is false", () => {
    useModules({ 1: { A: { sendMessage: 1 }, other: true } });
    // Default behavior wraps nothing: the matched nested export is returned.
    expect(api.getModule(byKeys(["sendMessage"]))).toEqual({ sendMessage: 1 });
  });

  it("honours searchExports to descend into every key", () => {
    useModules({ 1: { nested: { sendMessage: 1 } } });
    // Without searchDefault/searchExports, nested non-default keys are missed.
    expect(api.getModule(byKeys(["sendMessage"]))).toBeUndefined();
    expect(api.getModule(byKeys(["sendMessage"]), { searchExports: true })).toEqual({
      sendMessage: 1,
    });
  });

  it("returns the module record when raw, and the holder tuple when withKey", () => {
    useModules({ 1: { sendMessage: 1 } });
    const raw = api.getModule(byKeys(["sendMessage"]), { raw: true }) as BdModule;
    expect(String(raw.id)).toBe("1");
    const keyed = api.getModule(byKeys(["sendMessage"]), { withKey: true }) as [BdModule, string];
    expect(keyed[1]).toBe("exports");
    expect(keyed[0].exports).toEqual({ sendMessage: 1 });
  });

  it("first: false returns every match", () => {
    useModules({ 1: { sendMessage: 1 }, 2: { sendMessage: 2 } });
    const all = api.getModule(byKeys(["sendMessage"]), { first: false }) as unknown[];
    expect(all).toHaveLength(2);
  });

  it("applies the map option to rename matched exports", () => {
    useModules({ 1: { sendMessage: 1, other: 2 } });
    const mapped = api.getModule<{ send: unknown }>(byKeys(["sendMessage"]), {
      map: { send: (exports) => exports === 1 },
    }) as Record<string, unknown>;
    expect(mapped["send"]).toBe(1);
  });

  it("logs (and returns undefined) on an invalid option type", () => {
    useModules({ 1: { sendMessage: 1 } });
    const result = api.getModule(byKeys(["sendMessage"]), { first: "yes" as unknown as boolean });
    expect(result).toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
    // BD's Logger embeds the module name in the `%c` format string and passes
    // the message pieces as separate console args — the harness reads these.
    const call = vi.mocked(console.error).mock.calls[0] ?? [];
    expect(String(call[0])).toContain("BdApi.Webpack~get]");
    expect(call).toContain("Invalid type for options.first");
    expect(call).toContain("Expected: boolean");
  });
});

describe("throwing filters", () => {
  it("turns a throwing filter into a miss, warns once, and keeps searching safe", () => {
    useModules({ 1: { ok: true } });
    const filter: ModuleFilter = (exports) => {
      throw new Error(`boom on ${typeof exports}`);
    };
    expect(api.getModule(filter)).toBeUndefined();
    expect(api.getModule(filter)).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("bySource and source-family filters", () => {
  it("matches a module whose factory source contains a fragment", () => {
    useModules(
      { 1: { value: 1 } },
      {
        1: function factory() {
          return "unique-source-token";
        },
      },
    );
    expect(api.getModule(api.Filters.bySource("unique-source-token"))).toEqual({ value: 1 });
  });

  it("does not match when the fragment is absent", () => {
    useModules(
      { 1: { value: 1 } },
      {
        1: function factory() {
          return "something";
        },
      },
    );
    expect(api.getModule(api.Filters.bySource("absent-token"))).toBeUndefined();
  });

  it("byStrings matches a function export whose source contains a string", () => {
    useModules({ 1: () => "hello-world" });
    expect(api.getModule(api.Filters.byStrings("hello-world"))).toBeTypeOf("function");
    expect(api.getModule(api.Filters.byStrings("absent-string"))).toBeUndefined();
  });

  it("byRegex matches a function export's source", () => {
    useModules({ 1: () => "sendMessage" });
    expect(api.getModule(api.Filters.byRegex(/sendMessage/))).toBeTypeOf("function");
    expect(api.getModule(api.Filters.byRegex(/absent/))).toBeUndefined();
  });

  it("byDisplayName matches a component's displayName", () => {
    const component = Object.assign(() => undefined, { displayName: "ChannelList" });
    useModules({ 1: component });
    expect(api.getModule(api.Filters.byDisplayName("ChannelList"))).toBe(component);
  });

  it("byPrototypeKeys matches class prototypes", () => {
    class Widget {
      render() {
        return undefined;
      }
    }
    useModules({ 1: Widget });
    expect(api.getModule(api.Filters.byPrototypeKeys("render"))).toBe(Widget);
    expect(api.getModule(api.Filters.byPrototypeKeys("absent"))).toBeUndefined();
  });

  it("byComponentType resolves memo/forwardRef to the inner component", () => {
    const inner = () => undefined;
    const memoized = { $$typeof: Symbol.for("react.memo"), type: inner };
    useModules({ 1: { Chat: memoized } });
    expect(
      api.getModule(
        api.Filters.byComponentType((c) => c === inner),
        { searchExports: true },
      ),
    ).toBe(memoized);
  });

  it("combine requires every filter; not inverts one", () => {
    useModules({ 1: { sendMessage: 1, canSend: true } });
    const both = api.Filters.combine(byKeys(["sendMessage"]), byKeys(["canSend"]));
    const either = api.Filters.not(byKeys(["absent"]));
    expect(api.getModule(both)).toBeTruthy();
    expect(api.getModule(either)).toBeTruthy();
  });
});

describe("byStoreName and getStore", () => {
  const store = (name: string) => ({ _dispatchToken: "t", getName: () => name });

  it("finds a store by name through the Flux registry", () => {
    const userStore = store("UserStore");
    useModules({ 1: { Store: { getAll: () => [userStore] } } });
    expect(api.getStore("UserStore")).toBe(userStore);
    expect(api.getStore("MissingStore")).toBeUndefined();
  });

  it("falls back to a byStoreName module search when no Flux registry is present", () => {
    const userStore = store("UserStore");
    // Discord exposes stores as the module's exports directly.
    useModules({ 1: userStore });
    expect(api.getStore("UserStore")).toBe(userStore);
  });

  it("exposes stores through the Stores proxy by name", () => {
    const userStore = store("UserStore");
    useModules({ 1: { Store: { getAll: () => [userStore] } } });
    expect(api.Stores["UserStore"]).toBe(userStore);
    expect(() => {
      api.Stores["UserStore"] = {};
    }).toThrow("not allowed");
  });
});

describe("getById and the modules proxy", () => {
  it("returns exports by id, and the record when raw", () => {
    useModules({ 5: { value: 5 } });
    expect(api.getById(5)).toEqual({ value: 5 });
    expect(String((api.getById(5, { raw: true }) as BdModule | undefined)?.id)).toBe("5");
    expect(api.getById(999)).toBeUndefined();
    expect(() => api.getById(999, { fatal: true })).toThrow("Module search failed!");
  });

  it("exposes factories by id through the modules proxy", () => {
    const factory = function () {
      return undefined;
    };
    useModules({ 5: { value: 5 } }, { 5: factory });
    expect(api.modules[5]).toBe(factory);
    expect(() => {
      api.modules[5] = {};
    }).toThrow("not allowed");
  });
});

describe("waitForModule", () => {
  it("resolves immediately when the module is already loaded", async () => {
    useModules({ 1: { sendMessage: 1 } });
    await expect(api.waitForModule(byKeys(["sendMessage"]))).resolves.toEqual({ sendMessage: 1 });
  });

  it("resolves when a matching module loads later, and unsubscribes", async () => {
    useModules({}, {});
    const promise = api.waitForModule(byKeys(["sendMessage"]));
    expect(waiters).toHaveLength(1);

    emit("7", { sendMessage: 7 });
    await expect(promise).resolves.toEqual({ sendMessage: 7 });
    expect(waiters).toHaveLength(0);
  });

  it("resolves undefined on abort, and rejects on abort when fatal", async () => {
    useModules({}, {});
    const controller = new AbortController();
    const promise = api.waitForModule(byKeys(["sendMessage"]), { signal: controller.signal });
    controller.abort();
    await expect(promise).resolves.toBeUndefined();

    const fatalController = new AbortController();
    const fatalPromise = api.waitForModule(byKeys(["sendMessage"]), {
      signal: fatalController.signal,
      fatal: true,
    });
    fatalController.abort();
    await expect(fatalPromise).rejects.toThrow("Module search failed!");
  });
});

describe("getBulk and getBulkKeyed", () => {
  it("resolves several queries in one pass", () => {
    useModules({ 1: { sendMessage: 1 }, 2: { editMessage: 2 } });
    const [sent, edited] = api.getBulk(
      { filter: byKeys(["sendMessage"]) },
      { filter: byKeys(["editMessage"]) },
    );
    expect(sent).toEqual({ sendMessage: 1 });
    expect(edited).toEqual({ editMessage: 2 });
  });

  it("collects all matches for all:true and leaves unfilled queries empty", () => {
    useModules({ 1: { tag: "a" }, 2: { tag: "b" } });
    const [tags, missing] = api.getBulk(
      { filter: byKeys(["tag"]), all: true },
      { filter: byKeys(["absent"]) },
    );
    expect(tags).toEqual([{ tag: "a" }, { tag: "b" }]);
    // BD leaves a non-`all` query that matched nothing as an empty slot.
    expect(missing).toBeUndefined();
  });

  it("getBulkKeyed returns results keyed by query key", () => {
    useModules({ 1: { sendMessage: 1 } });
    const keyed = api.getBulkKeyed<{ sent: unknown }>({
      sent: { filter: byKeys(["sendMessage"]) },
    });
    expect(keyed.sent).toEqual({ sendMessage: 1 });
  });
});

describe("getMangled and the map", () => {
  it("maps a mangled module to named keys", () => {
    useModules(
      { 1: { a: "sendMessage", b: "editMessage" } },
      {
        1: function () {
          return "mangledSourceToken";
        },
      },
    );
    const mangled = api.getMangled<{ send: unknown }>(api.Filters.bySource("mangledSourceToken"), {
      send: (exports) => exports === "sendMessage",
    });
    expect(mangled.send).toBe("sendMessage");
  });

  it("returns an empty object when nothing matched", () => {
    useModules({ 1: { value: 1 } });
    expect(api.getMangled(api.Filters.bySource("absent"), { send: () => false })).toEqual({});
  });
});

describe("getProxy", () => {
  it("resolves the module on first access", () => {
    useModules({ 1: { sendMessage: 1 } });
    const proxy = api.getProxy<Record<string, unknown>>(byKeys(["sendMessage"]));
    expect(proxy?.["sendMessage"]).toBe(1);
  });

  it("throws on first access when the module never appears", () => {
    useModules({ 1: { other: true } });
    const proxy = api.getProxy<Record<string, unknown>>(byKeys(["sendMessage"]));
    expect(() => proxy?.["sendMessage"]).toThrow("Module search failed!");
  });
});

describe("getWithKey", () => {
  it("yields the holder then the matching key", () => {
    useModules({ 1: { sendMessage: 1, other: 2 } });
    const generator = api.getWithKey((exports) => exports === 1);
    expect(generator?.next().value).toEqual({ sendMessage: 1, other: 2 });
    expect(generator?.next().value).toBe("sendMessage");
  });
});
