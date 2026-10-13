/**
 * Unit tests for the Shelter eval contract: the plugin's free `shelter`
 * reference binds to the per-plugin edition, a file that produces anything
 * other than a lifecycle object fails with a named reason, and a throwing
 * `onLoad` propagates rather than being swallowed.
 */

import { describe, expect, it } from "vitest";

import { evaluateShelterPlugin } from "./evaluate";

const API = { marker: "the-api" };

describe("evaluateShelterPlugin", () => {
  it("binds the plugin's free `shelter` reference to the API it was given", () => {
    const plugin = evaluateShelterPlugin(
      "({ onLoad() { if (shelter.marker !== 'the-api') throw new Error('wrong api'); } })",
      "demo",
      API,
    );

    expect(() => plugin.onLoad?.()).not.toThrow();
  });

  it("returns whatever object the file exports, hooks included", () => {
    const plugin = evaluateShelterPlugin(
      "({ onLoad() {}, onUnload() {}, settings() { return 'panel'; } })",
      "demo",
      API,
    );

    expect(typeof plugin.onLoad).toBe("function");
    expect(typeof plugin.onUnload).toBe("function");
    expect(plugin.settings?.({})).toBe("panel");
  });

  it("lets an `onLoad` throw propagate untouched", () => {
    const plugin = evaluateShelterPlugin(
      "({ onLoad() { throw new Error('boom'); } })",
      "demo",
      API,
    );
    expect(() => plugin.onLoad?.()).toThrow("boom");
  });

  it("rejects a file that does not produce a lifecycle object", () => {
    expect(() => evaluateShelterPlugin("42", "demo", API)).toThrow(
      /plugin\.js evaluated to a number, expected an object/,
    );
    expect(() => evaluateShelterPlugin("null", "demo", API)).toThrow(/evaluated to null/);
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
    expect(evaluateShelterPlugin("({})", "demo", API)).toEqual({});
  });
});
