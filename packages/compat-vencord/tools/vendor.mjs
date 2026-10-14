#!/usr/bin/env node
/**
 * Vendors the Vencord source subset Ion's adapter needs.
 *
 *   node tools/vendor.mjs /path/to/vencord-clone [--check]
 *
 * Walks the transitive import closure of every plugin in `acceptance.json`
 * (plus cross-imported plugin libraries), copies those files byte-for-byte
 * into `vendor/vencord/` together with their license texts, and writes
 * `vendor/vencord/MANIFEST.json` with the upstream commit and a sha256 per
 * file so the vendored tree stays verifiable. Files that Ion deliberately
 * replaces (the webpack hook, the plugin bootstrap, main-process modules)
 * are listed in the manifest as shims instead of being copied — every
 * exclusion carries a reason.
 *
 * `--check` re-verifies an existing vendor tree against the manifest
 * (used by CI to prove the tree was not edited by hand).
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Vencord alias prefixes → roots inside the upstream `src/` tree. */
const ALIASES = {
  "@api": "api",
  "@utils": "utils",
  "@components": "components",
  "@webpack": "webpack",
  "@debug": "debug",
  "@shared": "shared",
  "@plugins": "plugins",
  "@main": "main",
};

/**
 * Modules Ion replaces with its own implementation. Copying them would
 * either pull in Electron (`main/*`) or duplicate the chunk hook Ion
 * already owns (`webpack.ts`, `patchWebpack.ts`).
 */
const SHIMS = {
  "src/webpack/webpack.ts":
    "replaced by src/shims/webpack.ts (Ion's chunk hook + discovery facade)",
  "src/webpack/patchWebpack.ts":
    "replaced by src/shims/patcher.ts (patches route into the Ion patch registry)",
  "src/main/themes.ts":
    "type-only consumers; main-process themes belong to the shell (types resolve via the stub)",
};

/** Specifiers that are virtual modules or host-provided globals. */
const VIRTUAL = new Set(["~plugins", "~git-hash", "~git-remote"]);

/**
 * License texts that ship with the copies they cover — attribution must
 * travel with vendored code even where there is no import edge.
 */
const LICENSES = ["LICENSE", "packages/discord-types/LICENSE"];

function resolveFile(base) {
  // `./style.css?managed` and friends: the query is a build-mode marker
  // (upstream's stylePlugin strips it), never part of the file name.
  const clean = base.split("?")[0];
  const candidates = [
    clean,
    `${clean}.ts`,
    `${clean}.tsx`,
    `${clean}.web.ts`,
    `${clean}.web.tsx`,
    `${clean}.desktop.ts`,
    `${clean}.desktop.tsx`,
    `${clean}.vesktop.ts`,
    `${clean}.vesktop.tsx`,
    `${clean}.d.ts`,
    // ESM-style specifiers (`@utils/constants.js`) name their TS source.
    ...(clean.endsWith(".js")
      ? [
          clean.slice(0, -".js".length),
          `${clean.slice(0, -".js".length)}.ts`,
          `${clean.slice(0, -".js".length)}.tsx`,
        ]
      : []),
    join(clean, "index.ts"),
    join(clean, "index.tsx"),
    join(clean, "index.d.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importSpecifiers(source) {
  const specs = new Set();
  const pattern =
    /(?:^|\n)\s*(?:import|export)\s[^"'\n]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const spec = match[1] ?? match[2];
    if (spec) specs.add(spec);
  }
  return specs;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Mirror of upstream tsconfig's `paths` for the aliases we understand. */
function resolveAlias(spec, srcRoot, upstreamRoot) {
  // Upstream consumes its workspace package (a `link:` dependency), not the
  // possibly-stale npm publish of it.
  if (spec === "@vencord/discord-types") {
    return join(upstreamRoot, "packages", "discord-types", "src", "index");
  }
  if (spec.startsWith("@vencord/discord-types/")) {
    return join(
      upstreamRoot,
      "packages",
      "discord-types",
      spec.slice("@vencord/discord-types/".length),
    );
  }
  if (spec === "@webpack") return join(srcRoot, "webpack", "webpack");
  if (spec === "@webpack/patcher") return join(srcRoot, "webpack", "patchWebpack");
  if (spec === "@webpack/wreq.d") return join(srcRoot, "webpack", "wreq.d");
  const alias = Object.keys(ALIASES).find((key) => spec === key || spec.startsWith(`${key}/`));
  if (!alias) return null;
  const rest = spec === alias ? "index" : spec.slice(alias.length + 1);
  return join(srcRoot, ALIASES[alias], rest);
}

export function computeClosure(upstreamRoot, entryFiles) {
  const srcRoot = join(upstreamRoot, "src");
  const files = new Set();
  const externals = new Set();
  const virtuals = new Set();
  const shims = new Set();
  const unresolved = new Set();

  const walk = (file) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const spec of importSpecifiers(source)) {
      let target;
      if (spec.startsWith(".")) {
        target = resolveFile(resolve(dirname(file), spec));
      } else if (spec.startsWith("@") || spec.startsWith("~")) {
        const aliased = resolveAlias(spec, srcRoot, upstreamRoot);
        if (aliased === null) {
          if (VIRTUAL.has(spec)) virtuals.add(spec);
          else externals.add(spec);
          continue;
        }
        target = resolveFile(aliased);
      } else if (spec.startsWith("file://")) {
        // Raw-text imports (upstream's fileUriPlugin): the file joins the
        // closure as data — the build reads it verbatim — so it is copied
        // but never walked for imports of its own.
        const raw = resolve(dirname(file), spec.slice("file://".length).split("?")[0]);
        if (existsSync(raw) && statSync(raw).isFile()) files.add(raw);
        else unresolved.add(`${spec} (from ${relative(upstreamRoot, file)})`);
        continue;
      } else {
        externals.add(spec);
        continue;
      }

      if (!target) {
        unresolved.add(`${spec} (from ${relative(upstreamRoot, file)})`);
        continue;
      }
      const rel = relative(upstreamRoot, target);
      if (SHIMS[rel]) {
        shims.add(rel);
        continue;
      }
      walk(target);
    }
  };

  for (const entry of entryFiles) walk(entry);
  return { files, externals, virtuals, shims, unresolved };
}

/**
 * Upstream files the adapter's own sources import: every `@x`/`~x`
 * specifier in src/*.ts resolves through the same alias table, so the
 * shims' dependencies (Logger, patches, …) and the barrels re-exported on
 * `window.Vencord` (components, utils) are part of the closure too.
 * Adapter-relative imports are skipped — they are our code, not upstream's.
 */
function adapterRoots(adapterSrc, srcRoot, upstreamRoot) {
  const roots = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
      for (const spec of importSpecifiers(readFileSync(full, "utf8"))) {
        if (!spec.startsWith("@") && !spec.startsWith("~")) continue;
        if (VIRTUAL.has(spec)) continue;
        const aliased = resolveAlias(spec, srcRoot, upstreamRoot);
        if (aliased === null) continue; // npm packages, e.g. @intrnl/*
        const file = resolveFile(aliased);
        if (!file) {
          process.stderr.write(
            `adapter import does not resolve upstream: ${spec} (from ${full})\n`,
          );
          process.exit(1);
        }
        roots.push(file);
      }
    }
  };
  scan(adapterSrc);
  return roots;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const upstreamArg = args.find((arg) => !arg.startsWith("--"));
  if (!upstreamArg) {
    process.stderr.write("usage: node tools/vendor.mjs <vencord-clone> [--check]\n");
    process.exit(2);
  }
  const upstream = resolve(upstreamArg);
  const srcRoot = join(upstream, "src");
  const acceptance = JSON.parse(readFileSync(join(packageRoot, "acceptance.json"), "utf8"));

  // Plugin entries: a folder may be a directory or a file (e.g. `_api/commands`).
  const entryFiles = [];
  for (const { folder } of acceptance) {
    const file = resolveFile(join(srcRoot, "plugins", folder));
    if (!file) {
      process.stderr.write(`acceptance entry does not resolve: ${folder}\n`);
      process.exit(1);
    }
    entryFiles.push(file);
  }
  entryFiles.push(...adapterRoots(join(packageRoot, "src"), srcRoot, upstream));

  const closure = computeClosure(upstream, entryFiles);
  if (closure.unresolved.size > 0) {
    process.stderr.write(`unresolved imports:\n${[...closure.unresolved].join("\n")}\n`);
    process.exit(1);
  }

  const commit = execSync("git rev-parse HEAD", { cwd: upstream, encoding: "utf8" }).trim();
  const remote = execSync("git remote get-url origin", { cwd: upstream, encoding: "utf8" })
    .trim()
    .replace(/\.git$/, "");
  const version = JSON.parse(readFileSync(join(upstream, "package.json"), "utf8")).version;
  const vendorRoot = join(packageRoot, "vendor", "vencord");

  const manifest = {
    source: { repository: remote, commit, version, license: "GPL-3.0-or-later" },
    note: "Verbatim copy of the upstream import closure of acceptance.json plus the adapter's own imports; see THIRD_PARTY.md.",
    shims: Object.fromEntries([...closure.shims].sort().map((file) => [file, SHIMS[file]])),
    virtuals: [...closure.virtuals].sort(),
    externals: [...closure.externals].sort(),
    files: {},
  };
  const copied = [...new Set([...closure.files, ...LICENSES.map((rel) => join(upstream, rel))])]
    .map((file) => relative(upstream, file))
    .sort();
  for (const rel of copied) {
    const path = join(upstream, rel);
    if (!existsSync(path)) {
      process.stderr.write(`upstream file missing: ${rel}\n`);
      process.exit(1);
    }
    manifest.files[rel] = sha256(readFileSync(path));
  }

  const manifestPath = join(vendorRoot, "MANIFEST.json");
  if (check) {
    if (!existsSync(manifestPath)) {
      process.stderr.write("vendor/vencord/MANIFEST.json missing — run vendor.mjs first\n");
      process.exit(1);
    }
    const existing = JSON.parse(readFileSync(manifestPath, "utf8"));
    const failures = [];
    if (existing.source.commit !== commit) {
      failures.push(`upstream commit drifted: manifest ${existing.source.commit}, clone ${commit}`);
    }
    const version = JSON.parse(readFileSync(join(upstream, "package.json"), "utf8")).version;
    if (existing.source.version !== version) {
      failures.push(
        `upstream version drifted: manifest ${existing.source.version}, clone ${version}`,
      );
    }
    for (const [rel, expected] of Object.entries(existing.files)) {
      const path = join(vendorRoot, rel);
      if (!existsSync(path)) failures.push(`missing ${rel}`);
      else if (sha256(readFileSync(path)) !== expected) failures.push(`modified ${rel}`);
    }
    if (failures.length > 0) {
      process.stderr.write(`${failures.length} vendor drift problem(s):\n${failures.join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write(
      `vendor OK: ${Object.keys(existing.files).length} files match ${commit}\n`,
    );
    return;
  }

  rmSync(vendorRoot, { recursive: true, force: true });
  for (const rel of Object.keys(manifest.files)) {
    const target = join(vendorRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(upstream, rel), target);
  }
  mkdirSync(vendorRoot, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `vendored ${Object.keys(manifest.files).length} files from ${commit}\n` +
      `shims: ${Object.keys(manifest.shims).join(", ") || "none"}\n` +
      `externals: ${manifest.externals.join(", ") || "none"}\n`,
  );
}

main();
