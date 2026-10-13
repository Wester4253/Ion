/**
 * Theme headers — the `/** … *\/` block a theme file opens with.
 *
 * Every ecosystem Ion loads themes from uses the same byte format because
 * they all inherited it from BetterDiscord: a JSDoc comment whose `@name`,
 * `@description`, `@author`, `@version`, `@license` and `@source` tags
 * describe the file. Vencord's `getThemeInfo` (vendored under
 * `compat-vencord/vendor`, itself a port of BD's `jsdoc.ts`) splits the block
 * on the same "newline + `*` + single space" rule, unescapes `\@` the same
 * way, and falls back the same way, so one parser serves both adapters — the
 * formats really are byte-compatible (see THIRD_PARTY.md).
 *
 * Where Ion deliberately goes further is a file with no block at all. Upstream
 * refuses those ("no meta comment on the first line"), which is why a
 * hand-written or freshly downloaded `.theme.css` that skipped the header is
 * invisible in both mods. Ion accepts it as plain CSS and takes the theme's
 * name from the file name the caller passes — that is the capability this
 * module exists for.
 */

/** A theme's identity as its header block (or its filename) describes it. */
export interface ThemeHeader {
  readonly name: string;
  readonly description: string;
  /** Every `@author` line; empty only for a file with no header. */
  readonly authors: readonly string[];
  readonly version?: string | undefined;
  /** Whether the values came from a header block or from the file name. */
  readonly source: "header" | "plain";
}

export interface ParseThemeHeaderOptions {
  /**
   * File the CSS was read from, used to name a header-less theme:
   * `Radial.theme.css` → `Radial` (see {@link themeNameFromFilename}).
   * Without it, a file that carries no header has no name at all.
   */
  readonly filename?: string | undefined;
}

/**
 * The placeholder values both upstream loaders degrade to. Kept verbatim
 * because themes in the wild ship incomplete headers and the settings UIs
 * show these strings.
 */
export const THEME_HEADER_FALLBACKS = {
  description: "No description provided",
  version: "???",
  author: "Unknown Author",
} as const;

/**
 * Splits a JSDoc block into its lines: newline, optional indentation, the `*`
 * every continuation line carries, and at most one space after it. Ported
 * from the rule both upstream parsers use (see the module header) — an inline
 * `*` inside a sentence must not split the line.
 */
const LINE_SPLIT = /[^\S\r\n]*?\r?(?:\r\n|\n)[^\S\r\n]*?\*[^\S\r\n]?/;
const ESCAPED_AT = /^\\@/;
const HEADER_START = "/**";
const HEADER_END = "*/";

/** Drops the BOM a text editor may have saved ahead of the block. */
function stripBom(css: string): string {
  return css.charCodeAt(0) === 0xfeff ? css.slice(1) : css;
}

/**
 * The first header block, anywhere in the file.
 *
 * Upstream requires the block on the first line; accepting it anywhere is
 * what lets a file that opens with a license comment still be recognized as
 * a theme, and a plain stylesheet that happens to contain a `/** … *\/`
 * comment without an `@name` in it still resolves to `plain`.
 */
function headerBlock(css: string): string {
  const start = stripBom(css).indexOf(HEADER_START);
  if (start === -1) return "";
  const rest = css.slice(start + HEADER_START.length);
  const end = rest.indexOf(HEADER_END);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Parses a block into `tag -> values`.
 *
 * A tag's value accumulates across continuation lines, and a tag repeated on
 * several lines becomes several values — `@author` lines are exactly that,
 * which is why they stay an array instead of last-one-wins.
 */
function parseFields(block: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  let tag = "";
  let accum = "";
  const push = (): void => {
    const value = accum.trim();
    if (tag.length === 0 || value.length === 0) return;
    const values = fields.get(tag);
    if (values === undefined) fields.set(tag, [value]);
    else values.push(value);
  };

  for (const line of block.split(LINE_SPLIT)) {
    if (line.length === 0) continue;
    // A tag is `@` followed by a non-space: upstream's
    // `charAt(0) === "@" && charAt(1) !== " "` check, so `@ foo` reads as
    // continuation text rather than a tag named `@ foo`.
    if (line.startsWith("@") && !line.startsWith("@ ")) {
      push();
      const space = line.indexOf(" ");
      tag = space === -1 ? "" : line.slice(1, space);
      accum = space === -1 ? "" : line.slice(space + 1);
    } else {
      accum += ` ${line.replace("\\n", "\n").replace(ESCAPED_AT, "@")}`;
    }
  }
  push();
  return fields;
}

function first(fields: Map<string, string[]>, tag: string): string | undefined {
  return fields.get(tag)?.[0];
}

const THEME_SUFFIX = /\.theme\.css$/i;
const CSS_SUFFIX = /\.css$/i;

/** The theme name a file implies: `Radial.theme.css` → `Radial`. */
export function themeNameFromFilename(filename: string): string {
  return filename.replace(THEME_SUFFIX, "").replace(CSS_SUFFIX, "");
}

/**
 * Reads a theme file's identity.
 *
 * Throws a TypeError when the file has no header *and* the caller named no
 * file to fall back on: without one of the two there is no theme name, and
 * the store would reject it anyway.
 */
export function parseThemeHeader(css: string, options?: ParseThemeHeaderOptions): ThemeHeader {
  const fields = parseFields(headerBlock(css));
  const name = first(fields, "name");
  if (name === undefined) {
    const filename = options?.filename;
    const fallbackName = filename === undefined ? undefined : themeNameFromFilename(filename);
    if (fallbackName === undefined || fallbackName.trim().length === 0) {
      throw new TypeError("a theme file without a header needs the file name it was read from");
    }
    return {
      name: fallbackName,
      description: THEME_HEADER_FALLBACKS.description,
      authors: [],
      // No header means no claimed version; "???" is upstream's placeholder
      // for a header that omitted the field, not for a file with none.
      version: undefined,
      source: "plain",
    };
  }

  const authors = fields.get("author") ?? [];
  return {
    name,
    description: first(fields, "description") ?? THEME_HEADER_FALLBACKS.description,
    authors: authors.length > 0 ? authors : [THEME_HEADER_FALLBACKS.author],
    version: first(fields, "version") ?? THEME_HEADER_FALLBACKS.version,
    source: "header",
    // `@license`, `@source`, `@website` and friends are parsed with
    // everything else and then deliberately dropped: they are not part of
    // Ion's theme identity, and their content must never leak into the
    // description or author fields.
  };
}
