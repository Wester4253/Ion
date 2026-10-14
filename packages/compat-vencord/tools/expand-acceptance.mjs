#!/usr/bin/env node
/**
 * Grows `acceptance.json` to every upstream plugin that applies to Ion's
 * build, against a pinned Vencord clone:
 *
 *   node tools/expand-acceptance.mjs /path/to/vencord-clone
 *
 * Ion renders like Vesktop, so a plugin applies when upstream's own
 * `globPlugins("vesktop")` would include it: the same target rules
 * (`.web` ships, `.browser`/`.discordDesktop`/`.dev` do not), evaluated
 * with `IS_DEV=false`. The tool never second-guesses upstream's list — it
 * re-runs the enumeration so a new upstream commit is picked up by
 * re-running this and then `tools/vendor.mjs`.
 *
 * Hand-written entries (groups A–D: the starter set with its Tier 3
 * checklists and diagnoses) are never touched — the tool only appends
 * missing plugins, as group `bulk`, with a Tier 3 line derived from the
 * plugin's own description so the owner's hand-check has a starting
 * point. An entry upstream no longer ships is an error: removing a
 * measured row is the owner's call, not the generator's.
 *
 * Names come from each definition's `name` literal, parsed with the same
 * TypeScript AST walk upstream's `scripts/generatePluginList.ts` uses, so
 * a generated row reads exactly as the plugin registers itself.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Upstream's plugin roots, in upstream's order (`scripts/build/common.mjs`). */
const PLUGIN_ROOTS = ["src/plugins/_api", "src/plugins/_core", "src/plugins", "src/userplugins"];

/** `getPluginTarget` from upstream's `scripts/utils.mjs`: the suffix, or null. */
function targetOf(fileName) {
  const parts = fileName.split(/[/\\]/);
  if (/^index\.tsx?$/.test(parts.at(-1))) parts.pop();
  const identifier = parts.at(-1).replace(/\.tsx?$/, "");
  const bits = identifier.split(".");
  return bits.length === 1 ? null : bits.at(-1);
}

/**
 * Upstream's exclusion rules for a vesktop renderer build with IS_DEV=false
 * (`globPlugins("vesktop")`): `.dev` needs IS_DEV, `.browser` and
 * `.discordDesktop` are wrong-shape builds, and `.web` is only excluded from
 * the Discord Desktop target — Vesktop, like Ion, ships it. `.desktop` and
 * `.vesktop` stay for the same reason.
 */
function excludedByTarget(target) {
  if (target === null) return false;
  return target === "dev" || target === "browser" || target === "discordDesktop";
}

/** The entry file for a plugin folder or file stem, as `vendor.mjs` resolves it. */
function resolveEntry(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.web.ts`,
    `${base}.web.tsx`,
    `${base}.desktop.ts`,
    `${base}.desktop.tsx`,
    `${base}.vesktop.ts`,
    `${base}.vesktop.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Reads `name` and `description` out of a `export default definePlugin({...})`
 * definition. Mirrors upstream's parser: both must be string literals, which
 * upstream enforces for every plugin it ships.
 */
function readDefinition(file) {
  const source = readFileSync(file, "utf8");
  const script = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const node of script.statements) {
    if (!ts.isExportAssignment(node) || !ts.isCallExpression(node.expression)) continue;
    if (
      !ts.isIdentifier(node.expression.expression) ||
      node.expression.expression.text !== "definePlugin"
    ) {
      continue;
    }
    const argument = node.expression.arguments[0];
    if (!ts.isObjectLiteralExpression(argument)) continue;
    const found = { name: null, description: null, required: false };
    for (const property of argument.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name.getText(script);
      if (key === "name" && ts.isStringLiteral(property.initializer)) {
        found.name = property.initializer.text;
      } else if (key === "description" && ts.isStringLiteral(property.initializer)) {
        found.description = property.initializer.text;
      } else if (key === "required") {
        found.required = property.initializer.kind === ts.SyntaxKind.TrueKeyword;
      }
    }
    if (found.name !== null) return found;
  }
  return null;
}

/** Every plugin upstream's vesktop build would ship, as `{ folder, file }`. */
function enumerate(upstream) {
  const plugins = [];
  for (const root of PLUGIN_ROOTS) {
    const full = join(upstream, root);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      if (entry.name === "index.ts" || entry.name === "index.tsx") continue;
      if (excludedByTarget(targetOf(entry.name))) continue;
      const stem =
        root === "src/plugins"
          ? entry.name
          : root.replace(/^src\/plugins\//, "") + "/" + entry.name;
      // Ion's folder convention drops the file extension (the existing
      // entries read `_api/commands`, not `_api/commands.ts`).
      const folder = stem.replace(/\.tsx?$/, "");
      const file = resolveEntry(join(upstream, "src", "plugins", folder));
      if (file === null) {
        throw new Error(`no entry file for ${folder}`);
      }
      plugins.push({ folder, file });
    }
  }
  return plugins;
}

/** A Tier 3 line for a generated row: the plugin's own promise, checked by hand. */
function tier3For(description) {
  return `Confirm by hand: ${description}`;
}

function main() {
  const clone = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  if (clone === undefined) {
    process.stderr.write("usage: node tools/expand-acceptance.mjs <vencord-clone>\n");
    process.exit(2);
  }
  const upstream = resolve(clone);
  const acceptancePath = join(packageRoot, "acceptance.json");
  const acceptance = JSON.parse(readFileSync(acceptancePath, "utf8"));

  const shipped = new Map(acceptance.map((entry) => [entry.folder, entry]));
  const applicable = enumerate(upstream);

  const gone = acceptance.filter((entry) => !applicable.some((p) => p.folder === entry.folder));
  if (gone.length > 0) {
    process.stderr.write(
      `acceptance entries upstream no longer ships: ${gone
        .map((entry) => entry.folder)
        .join(", ")}\nresolve by hand — a measured row is not deleted automatically\n`,
    );
    process.exit(1);
  }

  const additions = [];
  for (const { folder, file } of applicable) {
    if (shipped.has(folder)) continue;
    const definition = readDefinition(file);
    if (definition === null) {
      process.stderr.write(`no definePlugin name literal in ${folder}\n`);
      process.exit(1);
    }
    const nameTaken = acceptance.some((entry) => entry.name === definition.name);
    if (nameTaken) {
      process.stderr.write(`plugin name already in acceptance.json: ${definition.name}\n`);
      process.exit(1);
    }
    additions.push({
      group: "bulk",
      folder,
      name: definition.name,
      ...(definition.required ? { note: "upstream marks this plugin required" } : {}),
      tier3: tier3For(definition.description ?? definition.name),
    });
  }

  if (additions.length === 0) {
    process.stdout.write("acceptance.json already covers every applicable plugin\n");
    return;
  }

  additions.sort((a, b) => a.folder.localeCompare(b.folder));
  writeFileSync(acceptancePath, `${JSON.stringify([...acceptance, ...additions], null, 2)}\n`);
  process.stdout.write(
    `acceptance.json: ${acceptance.length} → ${acceptance.length + additions.length} entries\n`,
  );
}

main();
