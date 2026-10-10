import { describe, expect, it, vi } from "vitest";

import { CHUNK_GLOBAL, installChunkHook } from "./hook";
import type { ModuleFactory } from "./types";

const FACTORY: ModuleFactory = (module) => module;

describe("installChunkHook", () => {
  it("creates the chunk global and claims it", () => {
    const scope: Record<string, unknown> = {};
    const hook = installChunkHook(scope, () => undefined);

    expect(scope[CHUNK_GLOBAL]).toBe(hook.array);
    expect(hook.isWebpackActive()).toBe(false);
  });

  it("keeps an existing chunk array instead of replacing it", () => {
    const existing: unknown[] = [[["preloaded"]]];
    const scope: Record<string, unknown> = { [CHUNK_GLOBAL]: existing };
    const hook = installChunkHook(scope, () => undefined);

    expect(hook.array).toBe(existing);
    expect(hook.array).toHaveLength(1);
  });

  it("hands factories to onModules and buffers before webpack arrives", () => {
    const onModules = vi.fn();
    const hook = installChunkHook({}, onModules);
    const modules = { "7": FACTORY };

    hook.array.push([["7"], modules]);

    expect(onModules).toHaveBeenCalledWith(modules);
    expect(hook.array).toHaveLength(1);
    expect(hook.isWebpackActive()).toBe(false);
  });

  it("routes pushes through webpack's callback once installed, after wrapping", () => {
    const order: string[] = [];
    const hook = installChunkHook({}, () => {
      order.push("wrap");
    });
    const callback = vi.fn(() => {
      order.push("webpack");
      return 0;
    });

    hook.array.push = callback;
    const chunk: unknown[] = [["8"], { "8": FACTORY }];
    hook.array.push(chunk);

    expect(order).toEqual(["wrap", "webpack"]);
    expect(callback).toHaveBeenCalledWith(chunk);
    expect(hook.isWebpackActive()).toBe(true);
  });

  it("replaces the callback if webpack assigns push again", () => {
    const hook = installChunkHook({}, () => undefined);
    const first = vi.fn(() => 0);
    const second = vi.fn(() => 0);

    hook.array.push = first;
    hook.array.push([["1"], { "1": FACTORY }]);
    hook.array.push = second;
    hook.array.push([["2"], { "2": FACTORY }]);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps buffering if a non-function is assigned to push", () => {
    const onModules = vi.fn();
    const hook = installChunkHook({}, onModules);

    expect(Reflect.set(hook.array, "push", 5)).toBe(true);
    hook.array.push([["3"], { "3": FACTORY }]);

    expect(onModules).toHaveBeenCalledTimes(1);
    expect(hook.array).toHaveLength(1);
    expect(hook.isWebpackActive()).toBe(false);
  });

  it("mirrors the bundler's push chain without recursing (rspack regression)", () => {
    const calls: string[] = [];
    const onModules = vi.fn();
    const hook = installChunkHook({}, onModules);
    const chunk: unknown[] = [["1"], { "1": FACTORY }];

    // rspack's runtime callback: (e, chunk) => { process(chunk); e && e(chunk); }
    const makeRuntime =
      (name: string) =>
      (e: unknown, pushed: unknown): number => {
        calls.push(name);
        if (typeof e === "function") (e as (chunk: unknown) => unknown)(pushed);
        return 0;
      };

    // Runtime 1 setup, verbatim shape: f.push = s1.bind(null, f.push.bind(f));
    const s1 = makeRuntime("s1");
    hook.array.push = s1.bind(null, hook.array.push.bind(hook.array));
    hook.array.push(chunk);

    expect(calls).toEqual(["s1"]);
    expect(hook.array).toHaveLength(1);

    // Runtime 2 chains on top: every runtime must see the chunk once.
    const s2 = makeRuntime("s2");
    hook.array.push = s2.bind(null, hook.array.push.bind(hook.array));
    hook.array.push(chunk);

    expect(calls).toEqual(["s1", "s2", "s1"]);
    expect(hook.array).toHaveLength(2);
    expect(hook.isWebpackActive()).toBe(true);
  });

  it("ignores pushes whose first argument is not a chunk array", () => {
    const onModules = vi.fn();
    const hook = installChunkHook({}, onModules);

    hook.array.push("not-a-chunk");

    expect(onModules).not.toHaveBeenCalled();
    expect(hook.array).toHaveLength(1);
  });
});
