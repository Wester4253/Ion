/**
 * Unit tests for the BetterDiscord meta-header parser: the field map,
 * upstream's validation and fallbacks, and the runAt normalization the
 * loader maps onto host stages.
 */

import { describe, expect, it } from "vitest";

import { parseJsDoc, readAddonMeta } from "./meta";

const HEADER = `/**
 * @name TestPlugin
 * @version 1.2.3
 * @description Does testing
 * @author Tester
 * @invite abc123
 * @source https://example.com/src
 */
module.exports = class {};
`;

describe("readAddonMeta", () => {
  it("reads the standard fields", () => {
    const read = readAddonMeta("TestPlugin.plugin.js", HEADER);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.meta).toEqual({
      name: "TestPlugin",
      version: "1.2.3",
      description: "Does testing",
      author: "Tester",
      invite: "abc123",
      source: "https://example.com/src",
      runAt: "connection",
      filename: "TestPlugin.plugin.js",
    });
  });

  it("tolerates a BOM before the meta comment", () => {
    const read = readAddonMeta("TestPlugin.plugin.js", `\uFEFF${HEADER}`);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.meta.name).toBe("TestPlugin");
  });

  it("rejects a file whose first line carries no meta comment", () => {
    const read = readAddonMeta("NoMeta.plugin.js", `\n${HEADER}`);
    expect(read).toEqual({ ok: false, reason: "no meta comment on the first line" });
  });

  it("rejects a meta comment without @name", () => {
    const read = readAddonMeta("NoName.plugin.js", "/**\n * @version 1.0.0\n */");
    expect(read).toEqual({ ok: false, reason: "meta comment has no @name field" });
  });

  it("degrades missing author, version, and description like upstream", () => {
    const read = readAddonMeta("Bare.plugin.js", "/**\n * @name Bare\n */");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.meta.author).toBe("Unknown Author");
    expect(read.meta.version).toBe("???");
    expect(read.meta.description).toBe("No description provided");
    expect(read.meta.runAt).toBe("connection");
  });

  it("keeps runAt=idle and normalizes anything else to connection", () => {
    const idle = readAddonMeta("Idle.plugin.js", "/**\n * @name I\n * @runAt idle\n */");
    expect(idle.ok && idle.meta.runAt).toBe("idle");

    const other = readAddonMeta("Other.plugin.js", "/**\n * @name O\n * @runAt never\n */");
    expect(other.ok && other.meta.runAt).toBe("connection");
  });

  it("drops repeated optional tags instead of inventing a value", () => {
    const read = readAddonMeta(
      "Twice.plugin.js",
      "/**\n * @name T\n * @invite one\n * @invite two\n */",
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // Repeated fields parse to an array upstream; the typed meta keeps only
    // single-string values, so this one is absent rather than guessed.
    expect(read.meta.invite).toBeUndefined();
  });
});

describe("parseJsDoc", () => {
  it("accumulates continuation lines with a single space", () => {
    const fields = parseJsDoc("/**\n * @description first\n * second line\n */");
    expect(fields["description"]).toBe("first second line");
  });

  it("collects repeated tags into an array", () => {
    const fields = parseJsDoc("/**\n * @name X\n * @author A\n * @author B\n */");
    expect(fields["author"]).toEqual(["A", "B"]);
  });

  it("unescapes backslash-n and escaped at-signs on continuation lines", () => {
    const fields = parseJsDoc(
      "/**\n * @name X\n * @description first\n * second\\nline\n * \\@literal\n */",
    );
    expect(fields["description"]).toBe("first second\nline @literal");
  });

  it("treats an at-sign followed by a space as continuation text", () => {
    const fields = parseJsDoc("/**\n * @name X\n * @ not a field\n */");
    expect(fields["name"]).toBe("X @ not a field");
  });

  it("returns an empty map when there is no JSDoc block", () => {
    expect(parseJsDoc("module.exports = class {};")).toEqual({});
  });
});
