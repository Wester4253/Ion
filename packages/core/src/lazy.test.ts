import { describe, expect, it, vi } from "vitest";

import { proxyLazy } from "./lazy";

/** Let the creation tick pass so reads stop being deferred into child lazies. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("proxyLazy", () => {
  it("defers same-tick reads into child lazies, evaluating the factory once", async () => {
    const factory = vi.fn(() => ({ config: { answer: 42 }, name: "ion" }));
    const lazy = proxyLazy<{ config: { answer: number }; name: string }>(factory);

    // The upstream destructuring pattern: the read happens in the tick the
    // lazy was created, so it must not force the factory.
    const { config } = lazy;
    expect(factory).not.toHaveBeenCalled();

    await settle();
    expect(config.answer).toBe(42);
    expect(lazy.name).toBe("ion");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("evaluates on first post-tick access and caches the result", async () => {
    const factory = vi.fn(() => ({ answer: 42 }));
    const lazy = proxyLazy<{ answer: number }>(factory);

    await settle();
    expect(lazy.answer).toBe(42);
    expect(lazy.answer).toBe(42);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries a failing factory on each subsequent access", async () => {
    let calls = 0;
    const factory = (): { ok: boolean } => {
      calls += 1;
      if (calls < 3) throw new Error("not yet");
      return { ok: true };
    };
    const lazy = proxyLazy<{ ok: boolean }>(factory, 5);

    await settle();
    expect(() => lazy.ok).toThrow("not yet");
    expect(() => lazy.ok).toThrow("not yet");
    expect(lazy.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("retries a null result instead of caching it", async () => {
    let calls = 0;
    // Null is the "not ready" signal the retries exist for; the lazy's
    // exposed type is the eventual value once a lookup succeeds.
    const factory = (): { x: number } | null => {
      calls += 1;
      return calls < 3 ? null : { x: 1 };
    };
    const lazy = proxyLazy<{ x: number }>(factory as () => { x: number });

    await settle();
    expect(() => lazy.x).toThrow("null");
    expect(() => lazy.x).toThrow("null");
    expect(lazy.x).toBe(1);
    expect(calls).toBe(3);
  });

  it("throws the last error once attempts are exhausted", async () => {
    const factory = vi.fn((): { never: boolean } => {
      throw new Error("never");
    });
    const lazy = proxyLazy<{ never: boolean }>(factory, 2);

    await settle();
    expect(() => lazy.never).toThrow("never");
    expect(() => lazy.never).toThrow("never");
    expect(() => lazy.never).toThrow("never");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("supports calling a lazy function value", () => {
    // Calls are not deferred the way reads are (upstream behavior).
    const lazy = proxyLazy((): ((n: number) => number) => (n) => n * 2);
    expect(lazy(21)).toBe(42);
  });

  it("forwards property reads, existence checks, and keys", async () => {
    const lazy = proxyLazy(() => ({ alpha: 1 }));

    await settle();
    expect(lazy.alpha).toBe(1);
    expect("alpha" in lazy).toBe(true);
    expect("missing" in lazy).toBe(false);
    expect(Object.keys(lazy)).toEqual(["alpha"]);
  });
});
