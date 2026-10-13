/**
 * Unit tests for the Shelter eval contract: the plugin's free `shelter`
 * reference binds to the per-plugin edition, a file that produces anything
 * other than a lifecycle object fails with a named reason, a file that
 * produces nothing loads for its side effects with that said out loud, and a
 * throwing `onLoad` propagates rather than being swallowed.
 */

import { describe, expect, it } from "vitest";

import { evaluateShelterPlugin } from "./evaluate";

const API = { marker: "the-api" };

describe("evaluateShelterPlugin", () => {
  it("binds the plugin's free `shelter` reference to the API it was given", () => {
    const { plugin } = evaluateShelterPlugin(
      "({ onLoad() { if (shelter.marker !== 'the-api') throw new Error('wrong api'); } })",
      "demo",
      API,
    );

    expect(() => plugin.onLoad?.()).not.toThrow();
  });

  it("returns whatever object the file exports, hooks included", () => {
    const { plugin, note } = evaluateShelterPlugin(
      "({ onLoad() {}, onUnload() {}, settings() { return 'panel'; } })",
      "demo",
      API,
    );

    expect(note).toBeNull();
    expect(typeof plugin.onLoad).toBe("function");
    expect(typeof plugin.onUnload).toBe("function");
    expect(plugin.settings?.({})).toBe("panel");
  });

  it("lets an `onLoad` throw propagate untouched", () => {
    const { plugin } = evaluateShelterPlugin(
      "({ onLoad() { throw new Error('boom'); } })",
      "demo",
      API,
    );

    expect(() => plugin.onLoad?.()).toThrow("boom");
  });

  it("rejects a file that produces a value no plugin can be built from", () => {
    expect(() => evaluateShelterPlugin("42", "demo", API)).toThrow(
      /plugin\.js evaluated to a number, expected an object/,
    );
    expect(() => evaluateShelterPlugin("[1, 2]", "demo", API)).toThrow(/evaluated to an array/);
  });

  it("rejects a hook that is not callable, naming which one", () => {
    expect(() => evaluateShelterPlugin("({ onLoad: 5 })", "demo", API)).toThrow(
      /onLoad must be a function, got number/,
    );
    expect(() => evaluateShelterPlugin("({ onUnload: 'later' })", "demo", API)).toThrow(
      /onUnload must be a function, got string/,
    );
  });

  it("accepts a plugin that exports no hooks at all", () => {
    expect(evaluateShelterPlugin("({})", "demo", API)).toEqual({ plugin: {}, note: null });
  });

  it("loads a side-effect-only file for its side effects, and says so", () => {
    // Upstream spreads the result — `{ ...undefined }` is `{}` — and calls
    // `onLoad?.()`, so a plugin that installs its patches in the module body
    // and returns nothing is a real, working shape. It must not be failed,
    // and it must not be silently pretended to be an ordinary plugin either.
    const api: Record<string, unknown> = { marker: "the-api" };
    const evaluation = evaluateShelterPlugin(
      "(function () { shelter.ran = true; }())",
      "demo",
      api,
    );

    expect(evaluation.plugin).toEqual({});
    expect(evaluation.note).toContain("no lifecycle hooks");
    expect(api["ran"]).toBe(true);
  });
});
