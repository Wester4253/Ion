/**
 * Unit tests for the shared theme-header parser: the BD/Vencord block, the
 * plain-CSS fallback (the capability Ion adds), and the line rules both
 * upstream parsers rely on.
 */

import { describe, expect, it } from "vitest";

import { parseThemeHeader, themeNameFromFilename } from "./themeHeaders";

function header(...lines: string[]): string {
  const body = lines.map((line) => ` * ${line}\n`).join("");
  return `/**\n${body} */\n:root { color: red; }\n`;
}

describe("parseThemeHeader", () => {
  it("reads a full BetterDiscord-style header", () => {
    const css = header(
      "@name Radial",
      "@version 1.2.3",
      "@description A radial gradient theme",
      "@author Tester",
      "@license MIT",
      "@source https://example.test/radial",
    );

    const parsed = parseThemeHeader(css, { filename: "unused" });

    expect(parsed).toEqual({
      name: "Radial",
      description: "A radial gradient theme",
      authors: ["Tester"],
      version: "1.2.3",
      source: "header",
    });
  });

  it("reads a Vencord theme header (the formats are byte-compatible)", () => {
    // Theme files are shared between the two ecosystems through BD's site,
    // so the block is the same; Vencord only adds tags of its own.
    const css = header("@name Aurora", "@author Vendicated", "@version 2.0", "@description Test");

    expect(parseThemeHeader(css)).toEqual({
      name: "Aurora",
      description: "Test",
      authors: ["Vendicated"],
      version: "2.0",
      source: "header",
    });
  });

  it("collects every @author line", () => {
    const css = header("@name Two", "@author First", "@author Second");

    expect(parseThemeHeader(css).authors).toEqual(["First", "Second"]);
  });

  it("applies upstream fallbacks for a header that omits fields", () => {
    const parsed = parseThemeHeader(header("@name Sparse"));

    expect(parsed.authors).toEqual(["Unknown Author"]);
    expect(parsed.version).toBe("???");
    expect(parsed.description).toBe("No description provided");
  });

  it("joins continuation lines into one value", () => {
    const css = header("@name Radio", "@description First line", "second line", "third line");

    expect(parseThemeHeader(css).description).toBe("First line second line third line");
  });

  it("unescapes a leading \\@ on a continuation line", () => {
    const css = header("@name Escapes", "@description Mentions", "\\@keyframes inline");

    expect(parseThemeHeader(css).description).toBe("Mentions @keyframes inline");
  });

  it("turns a literal \\n sequence inside a continuation line into a newline", () => {
    const css = header("@name Newline", "@description first", "second\\nthird");

    expect(parseThemeHeader(css).description).toBe("first second\nthird");
  });

  it("ignores a BOM ahead of the block", () => {
    const css = `\uFEFF${header("@name Bom", "@author Tester")}`;

    expect(parseThemeHeader(css)).toEqual({
      name: "Bom",
      description: "No description provided",
      authors: ["Tester"],
      version: "???",
      source: "header",
    });
  });

  it("treats an empty file as plain CSS named after the file", () => {
    expect(parseThemeHeader("", { filename: "Empty.theme.css" })).toEqual({
      name: "Empty",
      description: "No description provided",
      authors: [],
      version: undefined,
      source: "plain",
    });
  });

  it("accepts plain CSS with no header at all", () => {
    const css = "/* a plain stylesheet */\n:root { --x: 1; }\nbody { color: red; }";

    expect(parseThemeHeader(css, { filename: "Handwritten.css" })).toEqual({
      name: "Handwritten",
      description: "No description provided",
      authors: [],
      version: undefined,
      source: "plain",
    });
  });

  it("accepts a stylesheet whose comment block has no @name", () => {
    const css = "/**\n * just a note about the stylesheet\n */\n:root {}\n";

    expect(parseThemeHeader(css, { filename: "Noted" }).source).toBe("plain");
  });

  it("finds a header that is not on the first line", () => {
    const css = `/* a license comment */\n${header("@name Late", "@author Tester")}`;

    expect(parseThemeHeader(css).name).toBe("Late");
  });

  it("throws when neither the header nor the caller names the theme", () => {
    expect(() => parseThemeHeader(":root {}")).toThrow(TypeError);
    expect(() => parseThemeHeader(":root {}", { filename: "  " })).toThrow(TypeError);
  });
});

describe("themeNameFromFilename", () => {
  it("strips the theme and CSS suffixes", () => {
    expect(themeNameFromFilename("Radial.theme.css")).toBe("Radial");
    expect(themeNameFromFilename("Handwritten.css")).toBe("Handwritten");
    expect(themeNameFromFilename("Handwritten")).toBe("Handwritten");
  });
});
