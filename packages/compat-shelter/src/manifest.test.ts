/**
 * Unit tests for `plugin.json` parsing: what must be there, what passes
 * through untouched, and the messages a bad file produces — the same
 * messages the scoreboard reports as that plugin's reason for failing.
 */

import { describe, expect, it } from "vitest";

import { parseManifest } from "./manifest";

const ORIGIN = "shelter/plugins/blur-nsfw/plugin.json";

describe("parseManifest", () => {
  it("keeps every key, including non-string ones", () => {
    const manifest = parseManifest(
      JSON.stringify({ name: "Blur NSFW", author: "Somebody", stars: 12, hash: null }),
      ORIGIN,
    );

    expect(manifest.name).toBe("Blur NSFW");
    expect(manifest["author"]).toBe("Somebody");
    expect(manifest["stars"]).toBe(12);
    expect(manifest["hash"]).toBeNull();
  });

  it("requires a non-empty name, since the host keys plugins by it", () => {
    expect(() => parseManifest(JSON.stringify({}), ORIGIN)).toThrow(
      /plugin\.json needs a non-empty "name" string/,
    );
    expect(() => parseManifest(JSON.stringify({ name: "   " }), ORIGIN)).toThrow(
      /needs a non-empty "name" string/,
    );
    expect(() => parseManifest(JSON.stringify({ name: 42 }), ORIGIN)).toThrow(
      /needs a non-empty "name" string/,
    );
  });

  it("names the file and the reason when the JSON is malformed", () => {
    expect(() => parseManifest("{", ORIGIN)).toThrow(
      /^shelter\/plugins\/blur-nsfw\/plugin\.json: plugin\.json is not valid JSON:/,
    );
  });

  it("rejects a top level that is not an object", () => {
    expect(() => parseManifest("[]", ORIGIN)).toThrow(/must contain a JSON object, got object/);
    expect(() => parseManifest("null", ORIGIN)).toThrow(/must contain a JSON object, got object/);
    expect(() => parseManifest('"hi"', ORIGIN)).toThrow(/must contain a JSON object, got string/);
  });

  it("freezes the result so nothing can rewrite it afterwards", () => {
    const manifest = parseManifest(JSON.stringify({ name: "A" }), ORIGIN);
    expect(Object.isFrozen(manifest)).toBe(true);
  });
});
