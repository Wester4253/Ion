import { describe, expect, it, vi } from "vitest";

import { createLogger, type Logger } from "../logging";
import { PatchRegistry, type Patch } from "../patches";
import { createWebpackRuntime, isWebpackRequire, type WebpackRuntime } from "./runtime";
import type { CacheEntry, ModuleFactory, WebpackRequire } from "./types";

interface CapturedLog {
  readonly logger: Logger;
  readonly lines: string[];
}

function makeLogger(): CapturedLog {
  const lines: string[] = [];
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      lines.push(`${level}: ${args.map(String).join(" ")}`);
    };
  return { logger: { info: record("info"), warn: record("warn"), error: record("error") }, lines };
}

function makeRequire(): WebpackRequire {
  const c: Record<PropertyKey, CacheEntry | undefined> = {};
  const m: Record<PropertyKey, ModuleFactory | undefined> = {};
  return Object.assign((id: PropertyKey): unknown => c[id]?.exports, { c, m });
}

function makeRuntime(...patches: Patch[]): { runtime: WebpackRuntime; lines: string[] } {
  const captured = makeLogger();
  const runtime = createWebpackRuntime({
    registry: new PatchRegistry(patches),
    logger: captured.logger,
  });
  return { runtime, lines: captured.lines };
}

/** A factory whose source we fully control (no build-tool rewriting). */
function makeOriginal(): ModuleFactory {
  const source = "function targetFactory(module, exports, require) { exports.value = 1; }";
  // Evaluated as an expression so the fixture keeps this exact source text.
  return (0, eval)(`0,${source}`) as ModuleFactory;
}

function run(
  factory: ModuleFactory,
  exports: Record<string, unknown>,
  require_: WebpackRequire,
): void {
  const module = { id: "7", exports };
  Reflect.apply(factory, undefined, [module, exports, require_]);
}

const VALUE_PATCH: Patch = {
  plugin: "TestPlugin",
  find: "value = 1",
  replacement: { match: "value = 1", replace: "value = 2" },
};

describe("isWebpackRequire", () => {
  it("recognizes the real shape", () => {
    expect(isWebpackRequire(makeRequire())).toBe(true);
    expect(isWebpackRequire(() => undefined)).toBe(false);
    expect(isWebpackRequire(null)).toBe(false);
  });
});

describe("createWebpackRuntime", () => {
  it("wraps factories in place and keeps originals for source search", () => {
    const { runtime } = makeRuntime();
    const original = makeOriginal();
    const modules: Record<string, ModuleFactory> = { "7": original };

    runtime.wrapChunkModules(modules);

    expect(modules["7"]).not.toBe(original);
    expect(runtime.factories.get("7")).toEqual([original]);
    // The proxy still stringifies to the original source for findByCode.
    expect(String(modules["7"])).toContain("value = 1");
  });

  it("captures every webpack require instance from factory runs", () => {
    const { runtime } = makeRuntime();
    const modules: Record<string, ModuleFactory> = { "7": makeOriginal() };
    runtime.wrapChunkModules(modules);
    const require_ = makeRequire();

    expect(runtime.getRequires()).toEqual([]);
    run(modules["7"] ?? makeOriginal(), { value: 0 }, require_);
    run(modules["7"] ?? makeOriginal(), { value: 0 }, require_);
    expect(runtime.getRequires()).toEqual([require_]);
  });

  it("runs factories unmodified when no patches are registered", () => {
    const { runtime, lines } = makeRuntime();
    const modules: Record<string, ModuleFactory> = { "7": makeOriginal() };
    runtime.wrapChunkModules(modules);

    const exports: Record<string, unknown> = { value: 0 };
    run(modules["7"] ?? makeOriginal(), exports, makeRequire());

    expect(exports["value"]).toBe(1);
    expect(lines).toEqual([]);
  });

  it("applies registered patches before the factory executes", () => {
    const { runtime, lines } = makeRuntime(VALUE_PATCH);
    const modules: Record<string, ModuleFactory> = { "7": makeOriginal() };
    runtime.wrapChunkModules(modules);

    const exports: Record<string, unknown> = { value: 0 };
    run(modules["7"] ?? makeOriginal(), exports, makeRequire());

    expect(exports["value"]).toBe(2);
    expect(lines.join("\n")).toContain("patched module 7 by TestPlugin");
  });

  it("falls back to the original when rebuilt code is invalid, naming the plugin", () => {
    const brokenPatch: Patch = {
      plugin: "TestPlugin",
      find: "value = 1",
      replacement: { match: "value = 1", replace: "value = 1; definitely not javascript" },
    };
    const { runtime, lines } = makeRuntime(brokenPatch);
    const modules: Record<string, ModuleFactory> = { "7": makeOriginal() };
    runtime.wrapChunkModules(modules);

    const exports: Record<string, unknown> = { value: 0 };
    run(modules["7"] ?? makeOriginal(), exports, makeRequire());

    expect(exports["value"]).toBe(1);
    const output = lines.join("\n");
    expect(output).toContain("patch by TestPlugin");
    expect(output).toContain("produced invalid code");
  });

  it("recovers when a patched factory throws, then runs the original", () => {
    const throwingPatch: Patch = {
      plugin: "TestPlugin",
      find: "value = 1",
      replacement: { match: "exports.value = 1", replace: 'throw new Error("patch bug")' },
    };
    const { runtime, lines } = makeRuntime(throwingPatch);
    const modules: Record<string, ModuleFactory> = { "7": makeOriginal() };
    runtime.wrapChunkModules(modules);

    const exports: Record<string, unknown> = { value: 0 };
    expect(() => {
      run(modules["7"] ?? makeOriginal(), exports, makeRequire());
    }).not.toThrow();

    expect(exports["value"]).toBe(1);
    expect(lines.join("\n")).toContain("running the original");
  });

  it("notifies module listeners after execution and stops after unsubscribe", () => {
    const { runtime } = makeRuntime();
    const seen: [unknown, PropertyKey][] = [];
    const off = runtime.onModule((exports, id) => {
      seen.push([exports, id]);
    });

    const modules: Record<string, ModuleFactory> = { "7": makeOriginal() };
    runtime.wrapChunkModules(modules);
    const exports: Record<string, unknown> = { value: 0 };
    run(modules["7"] ?? makeOriginal(), exports, makeRequire());
    expect(seen).toEqual([[exports, "7"]]);

    off();
    const more: Record<string, ModuleFactory> = { "8": makeOriginal() };
    runtime.wrapChunkModules(more);
    run(more["8"] ?? makeOriginal(), { value: 0 }, makeRequire());
    expect(seen).toHaveLength(1);
  });

  it("logs a listener error without breaking the factory", () => {
    const captured = makeLogger();
    const runtime = createWebpackRuntime({
      registry: new PatchRegistry(),
      logger: captured.logger,
    });
    runtime.onModule(() => {
      throw new Error("listener exploded");
    });

    const modules: Record<string, ModuleFactory> = { "7": makeOriginal() };
    runtime.wrapChunkModules(modules);

    const exports: Record<string, unknown> = { value: 0 };
    expect(() => {
      run(modules["7"] ?? makeOriginal(), exports, makeRequire());
    }).not.toThrow();
    expect(exports["value"]).toBe(1);
    expect(captured.lines.join("\n")).toContain("module listener errored");
  });

  it("does not double-wrap a factory seen by the chain twice", () => {
    const { runtime } = makeRuntime();
    const factory = makeOriginal();
    const modules: Record<string, ModuleFactory> = { "7": factory };

    runtime.wrapChunkModules(modules);
    const first = modules["7"];
    runtime.wrapChunkModules(modules);

    expect(modules["7"]).toBe(first);
    expect(runtime.factories.get("7")).toEqual([factory]);

    const exports: Record<string, unknown> = { value: 0 };
    run(modules["7"] ?? factory, exports, makeRequire());
    expect(exports["value"]).toBe(1);
  });

  it("skips non-function values in a chunk's modules", () => {
    const { runtime } = makeRuntime();
    const modules = { "7": null } as unknown as Record<string, ModuleFactory>;

    expect(() => {
      runtime.wrapChunkModules(modules);
    }).not.toThrow();
    expect(runtime.factories.size).toBe(0);
  });
});

describe("production logger", () => {
  it("prefixes every line with ion and the scope", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createLogger("webpack").warn("hello");
    expect(warn).toHaveBeenCalledWith("[ion] [webpack]", "hello");
    warn.mockRestore();
  });
});
