/**
 * Unit tests for `shelter.patcher`: upstream's three patch shapes with
 * upstream's semantics — `this` preserved into the callback, `before` able
 * to rewrite arguments, `instead` receiving the original — plus the scoped
 * variant's record-and-replay disposal.
 *
 * `this` is the load-bearing one: plugins read properties off the patched
 * object from inside a callback, so a wrapper that dropped it would patch
 * successfully and then misbehave in ways no load test would catch.
 */

import { describe, expect, it } from "vitest";

import { currentPluginScope } from "../logger";
import { createPatcher } from "./patcher";

const SCOPE = { id: "shelter.demo", name: "Demo" };

describe("createPatcher", () => {
  it("runs `after` after the original and replaces its result", () => {
    const patcher = createPatcher();
    const target = {
      greet(name: string): string {
        return `hi ${name}`;
      },
    };

    patcher.after("greet", target, (_args, ret) => `${String(ret)}!`);
    expect(target.greet("x")).toBe("hi x!");
  });

  it("lets `before` replace the arguments the original receives", () => {
    const patcher = createPatcher();
    const target = {
      add(a: number, b: number): number {
        return a + b;
      },
    };

    patcher.before("add", target, (args) => [args[0], (args[1] as number) + 1]);
    expect(target.add(1, 2)).toBe(4);
  });

  it("hands `instead` a callable original", () => {
    const patcher = createPatcher();
    const target = {
      read(): string {
        return "original";
      },
    };

    patcher.instead("read", target, (args, original) => `patched(${String(original(...args))})`);
    expect(target.read()).toBe("patched(original)");
  });

  it("restores the original once the returned unpatch runs", () => {
    const patcher = createPatcher();
    const target = {
      read(): string {
        return "original";
      },
    };

    const unpatch = patcher.after("read", target, () => "patched");
    expect(target.read()).toBe("patched");

    expect(unpatch()).toBe(true);
    expect(target.read()).toBe("original");
  });

  it("does not expose upstream's unpatchAll", () => {
    expect(Object.keys(createPatcher())).toEqual(["after", "before", "instead"]);
  });

  it("records scoped patches and replays them on disposal", () => {
    const disposes: (() => void)[] = [];
    const patcher = createPatcher({ disposes, scope: SCOPE });
    const target = {
      read(): string {
        return "original";
      },
    };

    patcher.after("read", target, () => "patched");
    expect(target.read()).toBe("patched");
    expect(disposes).toHaveLength(1);

    for (const dispose of disposes.splice(0)) dispose();
    expect(target.read()).toBe("original");
  });

  it("runs a scoped callback under the owning plugin's log scope", () => {
    const patcher = createPatcher({ disposes: [], scope: SCOPE });
    const target = {
      read(): string {
        return "original";
      },
    };

    let seen: string | undefined;
    patcher.after("read", target, () => {
      seen = currentPluginScope()?.name;
    });
    target.read();

    expect(seen).toBe("Demo");
  });

  it("still passes `this` through to a scoped callback", () => {
    const patcher = createPatcher({ disposes: [], scope: SCOPE });
    const target = {
      tag: "target",
      read(): string {
        return this.tag;
      },
    };

    patcher.after("read", target, function (this: unknown, args: unknown[], ret: unknown) {
      expect(Array.isArray(args)).toBe(true);
      return `${(this as { tag: string }).tag}/${String(ret)}`;
    });

    expect(target.read()).toBe("target/target");
  });

  it("reports a patch against something that is not a function", () => {
    const patcher = createPatcher();
    const target = { read: "not a function" };
    expect(() => patcher.after("read", target, () => undefined)).toThrow();
  });
});
