/**
 * BetterDiscord plugin meta headers — the `@name …` JSDoc block every
 * `*.plugin.js` file opens with.
 *
 * `parseJsDoc` is a verbatim port of BetterDiscord's `src/common/utils/
 * jsdoc.ts` (Apache-2.0, see THIRD_PARTY.md): the same split rules,
 * continuation-line accumulation, and repeated-field arrays the upstream
 * loader applies, because plugins in the wild rely on all three.
 * `readAddonMeta` mirrors `AddonManager.readAddon`'s validation and
 * fallbacks — a missing author/version/description degrades instead of
 * failing the addon — minus the filesystem it sits next to upstream.
 */

/** The typed subset of `@tags` the adapter reads (upstream's `Addon`). */
export interface BdAddonMeta {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly authorId?: string;
  readonly authorLink?: string;
  readonly website?: string;
  readonly invite?: string;
  readonly source?: string;
  readonly donate?: string;
  readonly patreon?: string;
  readonly icon?: string;
  /** When the addon starts: upstream's default `connection`, or `idle`. */
  readonly runAt: "connection" | "idle";
  readonly filename: string;
}

/** Result of reading one file: typed meta, or a one-line reason it failed. */
export type BdAddonRead =
  | { readonly ok: true; readonly meta: BdAddonMeta }
  | { readonly ok: false; readonly reason: string };

/** Optional `@tags` carried through only when present as a single string. */
const OPTIONAL_TAGS = [
  "authorId",
  "authorLink",
  "website",
  "invite",
  "source",
  "donate",
  "patreon",
  "icon",
] as const;

/**
 * Splits on the newline + whitespace + `*` that prefixes every line of a
 * JSDoc block; ported verbatim from upstream `parseJsDoc`.
 */
const splitRegex = /[^\S\r\n]*?\r?(?:\r\n|\n)[^\S\r\n]*?\*[^\S\r\n]?/;
const escapedAtRegex = /^\\@/;

/**
 * Parses the first JSDoc block of `text` into a field map. Field values
 * accumulate across continuation lines; a tag repeated on several lines
 * becomes an array, exactly like upstream.
 */
export function parseJsDoc(text: string): Record<string, string | string[]> {
  const head = text.split("/**", 2)[1];
  if (head === undefined) return {};
  const block = head.split("*/", 1)[0] ?? "";

  const out: Record<string, string | string[]> = {};
  let field = "";
  let accum = "";
  const push = (): void => {
    const value = accum.trim();
    if (!out[field]) {
      out[field] = value;
    } else if (Array.isArray(out[field])) {
      (out[field] as string[]).push(value);
    } else {
      out[field] = [out[field] as string, value];
    }
  };

  for (const line of block.split(splitRegex)) {
    if (line.length === 0) continue;
    // Equivalent to upstream's `charAt(0) === "@" && charAt(1) !== " "`.
    if (line.startsWith("@") && !line.startsWith("@ ")) {
      push();
      const space = line.indexOf(" ");
      field = line.substring(1, space);
      accum = line.substring(space + 1);
    } else {
      accum += ` ${line.replace("\\n", "\n").replace(escapedAtRegex, "@")}`;
    }
  }
  push();

  delete out[""];
  return out;
}

function optionalTags(fields: Record<string, string | string[]>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of OPTIONAL_TAGS) {
    const value = fields[key];
    if (typeof value === "string" && value.length > 0) picked[key] = value;
  }
  return picked;
}

/**
 * Reads the meta header of one plugin file's contents. The first line must
 * carry `/**` and `@name` is mandatory (upstream keys the addon's identity
 * off it); everything else falls back exactly where upstream falls back.
 */
export function readAddonMeta(filename: string, fileContent: string): BdAddonRead {
  // Strip the BOM a text editor may have saved the file with (upstream does
  // the same before the first-line check).
  const content = fileContent.charCodeAt(0) === 0xfeff ? fileContent.slice(1) : fileContent;
  const lineEnd = content.indexOf("\n");
  const firstLine = content.slice(0, lineEnd === -1 ? content.length : lineEnd);
  if (!firstLine.includes("/**")) {
    return { ok: false, reason: "no meta comment on the first line" };
  }

  const fields = parseJsDoc(content);
  const name = fields["name"];
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, reason: "meta comment has no @name field" };
  }

  const author = fields["author"];
  const version = fields["version"];
  const description = fields["description"];
  const runAt = fields["runAt"];

  return {
    ok: true,
    meta: {
      name,
      author: typeof author === "string" && author.length > 0 ? author : "Unknown Author",
      version: typeof version === "string" && version.length > 0 ? version : "???",
      description:
        typeof description === "string" && description.length > 0
          ? description
          : "No description provided",
      // Upstream: anything but the literal `idle` runs at `connection`.
      runAt: runAt === "idle" ? "idle" : "connection",
      filename,
      ...optionalTags(fields),
    },
  };
}
