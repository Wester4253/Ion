import { describe, expect, it } from "vitest";

import {
  canonicalizeMatch,
  PatchRegistry,
  toExpressionCode,
  type Patch,
  type Rebuild,
} from "./patches";

/** Accept every rebuild — the happy-path stub. */
const acceptRebuild: Rebuild = (code) => ({ ok: true, factory: code });

const SOURCE = "function factory(module, exports, require) { exports.value = 1; }";

function registryWith(...patches: Patch[]): PatchRegistry {
  return new PatchRegistry(patches);
}

describe("toExpressionCode", () => {
  it("prefixes arrow factories", () => {
    expect(toExpressionCode("(a, b) => a")).toBe("0,(a, b) => a");
  });

  it("normalizes function factories and drops their name", () => {
    expect(toExpressionCode("function mod(a, b) { return a; }")).toBe(
      "0,function(a, b) { return a; }",
    );
  });

  it("trims leading whitespace", () => {
    expect(toExpressionCode("  (m) => m")).toBe("0,(m) => m");
  });

  it("passes parenless sources through", () => {
    expect(toExpressionCode("notAParen")).toBe("0,notAParen");
  });
});

describe("canonicalizeMatch", () => {
  it("leaves strings untouched", () => {
    expect(canonicalizeMatch("plain")).toBe("plain");
  });

  it("turns \\i into an identifier matcher in RegExps", () => {
    const canonical = canonicalizeMatch(/"(\i)"/);
    expect(canonical).toBeInstanceOf(RegExp);
    expect((canonical as RegExp).test('"myVar"')).toBe(true);
    expect((canonical as RegExp).test('"1bad"')).toBe(false);
  });

  it("keeps flags", () => {
    expect((canonicalizeMatch(/x/g) as RegExp).flags).toBe("g");
  });
});

describe("PatchRegistry", () => {
  it("applies a string find and string replacement, naming the plugin", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value = 1",
      replacement: { match: "value = 1", replace: "value = 2" },
    });

    const outcome = registry.applyTo(SOURCE);
    expect(outcome.code).toContain("value = 2");
    expect(outcome.patchedBy).toEqual(["TestPlugin"]);
    expect(outcome.notices).toEqual([]);
    expect(outcome.code.startsWith("0,")).toBe(true);
  });

  it("applies replacements sequentially", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value",
      replacement: [
        { match: "value = 1", replace: "value = 2" },
        { match: "value = 2", replace: "value = 3" },
      ],
    });

    expect(registry.applyTo(SOURCE).code).toContain("value = 3");
  });

  it("supports regex matches with capture groups via replace functions", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value",
      replacement: {
        match: /value = (\d+)/,
        replace: (_match, digits) => `value = ${typeof digits === "string" ? digits : "?"}0`,
      },
    });

    expect(registry.applyTo(SOURCE).code).toContain("value = 10");
  });

  it("consumes a non-all patch after the first module it patches", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value = 1",
      replacement: { match: "value = 1", replace: "value = 2" },
    });

    expect(registry.size).toBe(1);
    expect(registry.applyTo(SOURCE).code).toContain("value = 2");
    expect(registry.size).toBe(0);

    const second = registry.applyTo(SOURCE);
    expect(second.code).toContain("value = 1");
    expect(second.patchedBy).toEqual([]);
  });

  it("keeps all-patches active for later modules", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value = 1",
      all: true,
      replacement: { match: "value = 1", replace: "value = 2" },
    });

    expect(registry.applyTo(SOURCE).code).toContain("value = 2");
    expect(registry.applyTo(SOURCE).code).toContain("value = 2");
    expect(registry.size).toBe(1);
  });

  it("resets global RegExps so a find matches across multiple modules", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: /value/g,
      all: true,
      replacement: { match: "value = 1", replace: "value = 2" },
    });

    expect(registry.applyTo(SOURCE).patchedBy).toEqual(["TestPlugin"]);
    expect(registry.applyTo(SOURCE).patchedBy).toEqual(["TestPlugin"]);
  });

  it("emits a no-effect warning naming plugin, match, and module", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value",
      replacement: { match: "does not exist", replace: "x" },
    });

    const outcome = registry.applyTo(SOURCE, { moduleId: "1234" });
    expect(outcome.patchedBy).toEqual([]);
    expect(outcome.notices).toHaveLength(1);
    expect(outcome.notices[0]).toMatchObject({ plugin: "TestPlugin", level: "warn" });
    expect(outcome.notices[0]?.message).toContain("had no effect");
    expect(outcome.notices[0]?.message).toContain("1234");
  });

  it("suppresses no-effect warnings with noWarn", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value",
      noWarn: true,
      replacement: { match: "does not exist", replace: "x" },
    });

    expect(registry.applyTo(SOURCE).notices).toEqual([]);
  });

  it("rolls back an entire group when one replacement has no effect", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value",
      group: true,
      replacement: [
        { match: "value = 1", replace: "value = 2" },
        { match: "never present", replace: "x" },
      ],
    });

    const outcome = registry.applyTo(SOURCE);
    expect(outcome.code).toBe(toExpressionCode(SOURCE));
    expect(outcome.patchedBy).toEqual([]);
    expect(outcome.notices.map((notice) => notice.message).join("\n")).toContain("undid group");
  });

  it("keeps earlier replacements when a later one fails ungrouped", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value",
      replacement: [
        { match: "value = 1", replace: "value = 2" },
        { match: "never present", replace: "x" },
      ],
    });

    const outcome = registry.applyTo(SOURCE);
    expect(outcome.code).toContain("value = 2");
    expect(outcome.patchedBy).toEqual(["TestPlugin"]);
    expect(outcome.notices[0]?.level).toBe("warn");
  });

  it("drops a patch whose predicate returns false at registration", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value",
      predicate: () => false,
      replacement: { match: "value = 1", replace: "value = 2" },
    });

    expect(registry.size).toBe(0);
    expect(registry.applyTo(SOURCE).code).toContain("value = 1");
  });

  it("propagates a throwing predicate as a registration error", () => {
    expect(() =>
      registryWith({
        plugin: "TestPlugin",
        find: "value",
        predicate: () => {
          throw new Error("bad predicate");
        },
        replacement: { match: "x", replace: "y" },
      }),
    ).toThrow("bad predicate");
  });

  it("excludes patches outside the build window and applies unknown builds", () => {
    const makePatch = (): Patch => ({
      plugin: "TestPlugin",
      find: "value = 1",
      fromBuild: 200_000,
      replacement: { match: "value = 1", replace: "value = 2" },
    });

    const excluded = registryWith(makePatch());
    expect(excluded.applyTo(SOURCE, { build: 100_000 }).code).toContain("value = 1");
    expect(excluded.size).toBe(0);

    const unknownBuild = registryWith(makePatch());
    expect(unknownBuild.applyTo(SOURCE).code).toContain("value = 2");
  });

  it("notices a rebuild failure and falls back to the original source", () => {
    const rebuild: Rebuild = (code) =>
      code.includes("value = 2")
        ? { ok: false, error: "unexpected token" }
        : { ok: true, factory: undefined };
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value = 1",
      replacement: { match: "value = 1", replace: "value = 2" },
    });

    const outcome = registry.applyTo(SOURCE, { moduleId: "42", rebuild });
    expect(outcome.code).toBe(toExpressionCode(SOURCE));
    expect(outcome.patchedBy).toEqual([]);
    expect(outcome.notices[0]).toMatchObject({ plugin: "TestPlugin", level: "error" });
    expect(outcome.notices[0]?.message).toContain("produced invalid code");
    expect(outcome.notices[0]?.message).toContain("42");
  });

  it("rolls back a group when the rebuild fails", () => {
    const rebuild: Rebuild = (code) =>
      code.includes("value = 3") ? { ok: false, error: "bad" } : { ok: true, factory: code };
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value",
      group: true,
      replacement: [
        { match: "value = 1", replace: "value = 2" },
        { match: "value = 2", replace: "value = 3" },
      ],
    });

    const outcome = registry.applyTo(SOURCE, { rebuild });
    expect(outcome.code).toBe(toExpressionCode(SOURCE));
    expect(outcome.patchedBy).toEqual([]);
    expect(outcome.notices.some((notice) => notice.message.includes("undid group"))).toBe(true);
  });

  it("returns the factory from the last successful rebuild", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value = 1",
      replacement: { match: "value = 1", replace: "value = 2" },
    });

    const outcome = registry.applyTo(SOURCE, { rebuild: acceptRebuild });
    expect(outcome.factory).toBe(outcome.code);
  });

  it("turns a throwing replace function into an error notice without throwing", () => {
    const registry = registryWith({
      plugin: "TestPlugin",
      find: "value",
      replacement: {
        match: "value = 1",
        replace: () => {
          throw new Error("boom");
        },
      },
    });

    const outcome = registry.applyTo(SOURCE);
    expect(outcome.code).toBe(toExpressionCode(SOURCE));
    expect(outcome.patchedBy).toEqual([]);
    expect(outcome.notices[0]).toMatchObject({ plugin: "TestPlugin", level: "error" });
    expect(outcome.notices[0]?.message).toContain("boom");
  });

  it("matches find against the original source while replacements act on patched code", () => {
    const registry = registryWith(
      {
        plugin: "PluginA",
        find: "value = 1",
        replacement: { match: "value = 1", replace: "value = 9" },
      },
      {
        plugin: "PluginB",
        find: "exports.value",
        replacement: { match: "value = 9", replace: "value = 3" },
      },
    );

    const outcome = registry.applyTo(SOURCE);
    expect(outcome.code).toContain("value = 3");
    expect(outcome.patchedBy).toEqual(["PluginA", "PluginB"]);
  });

  it("removes only the active patches attributed to a plugin", () => {
    const registry = registryWith(
      {
        plugin: "PluginA",
        find: "value = 1",
        replacement: { match: "value = 1", replace: "value = 2" },
      },
      {
        plugin: "PluginB",
        find: "value = 1",
        replacement: { match: "value = 1", replace: "value = 3" },
      },
      {
        plugin: "PluginA",
        find: "exports.value",
        replacement: { match: "exports.value", replace: "exports.value" },
      },
    );

    expect(registry.removeByPlugin("PluginA")).toBe(2);
    expect(registry.size).toBe(1);
    expect(registry.removeByPlugin("PluginA")).toBe(0);
    expect(registry.applyTo(SOURCE).patchedBy).toEqual(["PluginB"]);
  });

  it("counts registered, applied, and active patches per plugin", () => {
    const registry = registryWith(
      {
        plugin: "PluginA",
        find: "value = 1",
        replacement: { match: "value = 1", replace: "value = 2" },
      },
      {
        plugin: "PluginA",
        find: "no such module",
        replacement: { match: "x", replace: "y" },
      },
    );

    let stats = registry.stats();
    expect(stats["PluginA"]).toMatchObject({ registered: 2, applied: 0, active: 2 });

    registry.applyTo(SOURCE);
    stats = registry.stats();
    // One patch matched and changed code; the other never found its target.
    expect(stats["PluginA"]).toMatchObject({ registered: 2, applied: 1, active: 1 });
  });

  it("records notices against the plugin they belong to", () => {
    const registry = registryWith({
      plugin: "PluginA",
      find: "value = 1",
      replacement: { match: "value = 999", replace: "value = 2" },
    });

    registry.applyTo(SOURCE);
    const stats = registry.stats();
    expect(stats["PluginA"]?.applied).toBe(0);
    expect(stats["PluginA"]?.notices).toHaveLength(1);
    expect(stats["PluginA"]?.notices[0]?.message).toContain("had no effect");
  });

  it("resets the registered generation on disable but keeps applied history", () => {
    const registry = registryWith({
      plugin: "PluginA",
      find: "value = 1",
      replacement: { match: "value = 1", replace: "value = 2" },
    });
    registry.applyTo(SOURCE);
    expect(registry.stats()["PluginA"]).toMatchObject({ registered: 1, applied: 1, active: 0 });

    registry.removeByPlugin("PluginA");
    expect(registry.stats()["PluginA"]).toMatchObject({ registered: 0, applied: 1, active: 0 });
  });

  it("counts a group rollback as not applied", () => {
    const registry = registryWith({
      plugin: "PluginA",
      find: "value = 1",
      replacement: [
        { match: "value = 1", replace: "value = 2" },
        { match: "no such text", replace: "x" },
      ],
      group: true,
    });

    registry.applyTo(SOURCE);
    const stats = registry.stats();
    expect(stats["PluginA"]).toMatchObject({ applied: 0, active: 0 });
    expect(stats["PluginA"]?.notices.some((n) => n.message.includes("undid group"))).toBe(true);
  });
});
