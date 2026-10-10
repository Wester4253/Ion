import { describe, expect, it, vi } from "vitest";

import { proxyLazy } from "./lazy";

describe("proxyLazy", () => {
  it("evaluates on first access and caches the result", () => {
    const factory = vi.fn(() => ({ answer: 42 }));
    const lazy = proxyLazy<{ answer: number }>(factory);

    expect(lazy.answer).toBe(42);
    expect(lazy.answer).toBe(42);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries a failing factory on each subsequent access", () => {
    let calls = 0;
    const factory = (): { ok: boolean } => {
      calls += 1;
      if (calls < 3) throw new Error("not yet");
      return { ok: true };
    };
    const lazy = proxyLazy<{ ok: boolean }>(factory, 5);

    expect(() => lazy.ok).toThrow("not yet");
    expect(() => lazy.ok).toThrow("not yet");
    expect(lazy.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("throws the last error once attempts are exhausted", () => {
    const factory = vi.fn((): { never: boolean } => {
      throw new Error("never");
    });
    const lazy = proxyLazy<{ never: boolean }>(factory, 2);

    expect(() => lazy.never).toThrow("never");
    expect(() => lazy.never).toThrow("never");
    expect(() => lazy.never).toThrow("never");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("supports calling a lazy function value", () => {
    const lazy = proxyLazy((): ((n: number) => number) => (n) => n * 2);
    expect(lazy(21)).toBe(42);
  });

  it("describes a null result instead of leaking it", () => {
    const lazy = proxyLazy((): { x: number } => null as unknown as { x: number });
    expect(() => lazy.x).toThrow("null/undefined");
  });

  it("forwards property reads, existence checks, and keys", () => {
    const lazy = proxyLazy(() => ({ alpha: 1 }));

    expect(lazy.alpha).toBe(1);
    expect("alpha" in lazy).toBe(true);
    expect("missing" in lazy).toBe(false);
    expect(Object.keys(lazy)).toEqual(["alpha"]);
  });
});
