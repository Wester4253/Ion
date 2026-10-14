/**
 * compat-vencord bundle build.
 *
 * Compiles src/index.ts into dist/index.js — an IIFE whose exports become
 * `window.Vencord`, exactly like upstream's renderer build (format iife,
 * globalName Vencord). The shell appends the bundle to core and ui in one
 * script injection (see shell-desktop/src/main/bundle.ts).
 *
 * The generic scripts/bundle.mjs is manifest-driven and cannot express what
 * this package needs, so the build owns:
 *
 *   - aliases: upstream's tsconfig path names (@api/*, @utils/*, ...)
 *     resolved over vendor/vencord/src, with @webpack and @webpack/patcher
 *     pointing at Ion's shims (recorded in vendor/vencord/MANIFEST.json);
 *   - virtual modules: ~plugins (the registry over acceptance.json),
 *     ~git-hash and ~git-remote (upstream commit / this repo, from the
 *     vendor manifest and the Ion remote);
 *   - css: plain stylesheet imports compile into <style> elements at module
 *     evaluation, because the shell injects JS only — upstream links
 *     dist/renderer.css next to its script instead;
 *   - the compile-time flags of a Vesktop-kind build (IS_VESKTOP: true …),
 *     mirroring upstream's vesktop renderer target.
 *
 * Upstream and third-party versions are read from the vendor manifest and
 * package.json so the banner, the about tab and the user agent always
 * describe what was actually bundled.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorSrc = join(packageDir, "vendor", "vencord", "src");
const vendorRoot = join(packageDir, "vendor", "vencord");
const shimsDir = join(packageDir, "src", "shims");
const watch = process.argv.includes("--watch");

const acceptance = JSON.parse(readFileSync(join(packageDir, "acceptance.json"), "utf8"));
const manifest = JSON.parse(
  readFileSync(join(packageDir, "vendor", "vencord", "MANIFEST.json"), "utf8"),
);

/** Where builds of this adapter are published from. */
const ION_REMOTE = "Wester4253/Ion";

/** Upstream's tsconfig `paths`, with Ion's two shimmed entries replaced. */
const exactAliases = new Map([
  ["@webpack", join(shimsDir, "webpack.ts")],
  ["@webpack/patcher", join(shimsDir, "patcher.ts")],
  ["@webpack/wreq.d", join(vendorSrc, "webpack", "wreq.d")],
  ["@webpack/types", join(vendorSrc, "webpack", "types")],
  ["@webpack/common", join(vendorSrc, "webpack", "common")],
  ...["@api", "@components", "@debug", "@main", "@plugins", "@shared", "@utils"].map((scope) => [
    scope,
    join(vendorSrc, scope.slice(1)),
  ]),
]);

const prefixAliases = [
  ["@webpack/common/", `${join(vendorSrc, "webpack", "common")}${sep}`],
  ...["@api", "@components", "@debug", "@main", "@plugins", "@shared", "@utils"].map((scope) => [
    `${scope}/`,
    `${join(vendorSrc, scope.slice(1))}${sep}`,
  ]),
];

function aliasTarget(specifier) {
  const exact = exactAliases.get(specifier);
  if (exact !== undefined) return exact;
  for (const [prefix, target] of prefixAliases) {
    if (specifier.startsWith(prefix)) return target + specifier.slice(prefix.length);
  }
  return null;
}

/** Resolve an alias target the way tsc's `paths` would: file, then index. */
function probe(target) {
  const candidates = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.js`,
    // ESM-style specifiers (`@utils/constants.js`) name their TS source.
    ...(target.endsWith(".js")
      ? [target.slice(0, -".js".length), `${target.slice(0, -".js".length)}.ts`]
      : []),
    `${join(target, "index")}.ts`,
    `${join(target, "index")}.tsx`,
    `${join(target, "index")}.js`,
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
  );
}

const aliasPlugin = {
  name: "ion-vencord-alias",
  setup: (pluginBuild) => {
    // Upstream resolves this against its workspace package; the npm
    // publish of it is stale (no ToastPosition), so the vendored copy wins.
    // Only the enums path is a runtime import — the type-only paths are
    // erased by esbuild and intentionally left to fail loudly if a value
    // import ever appears.
    pluginBuild.onResolve({ filter: /^@vencord\/discord-types\/enums$/ }, (args) => {
      const file = probe(join(vendorRoot, "packages", "discord-types", "enums", "index.ts"));
      if (file === null) {
        return { errors: [{ text: `vendor tree missing ${args.path}; run tools/vendor.mjs` }] };
      }
      return { path: file };
    });
    pluginBuild.onResolve(
      { filter: /^@(webpack|api|components|debug|utils|plugins|shared|main)(\/|$)/ },
      (args) => {
        const target = aliasTarget(args.path);
        if (target === null) {
          return { errors: [{ text: `no alias mapping for ${args.path}` }] };
        }
        const file = probe(target);
        if (file === null) {
          return { errors: [{ text: `alias target does not exist: ${args.path} → ${target}` }] };
        }
        return { path: file };
      },
    );
  },
};

function pluginsModule() {
  const missing = acceptance.filter(
    (entry) => probe(join(vendorSrc, "plugins", entry.folder)) === null,
  );
  if (missing.length > 0) {
    throw new Error(
      `acceptance.json references plugin folders missing from vendor/vencord: ${missing
        .map((entry) => entry.folder)
        .join(", ")}`,
    );
  }

  const imports = acceptance
    .map((entry, index) => `import def${index} from "@plugins/${entry.folder}";`)
    .join("\n");
  const entries = acceptance
    .map((entry, index) => `  { def: def${index}, folder: ${JSON.stringify(entry.folder)} },`)
    .join("\n");

  return `// The settings store must exist before any plugin body runs: several
// plugins call migratePluginSettings(...) at module-eval, which reads
// SettingsStore.plain. Settings imports this barrel back, so naming it
// first lets the store complete here, mid-cycle — the same ordering
// upstream gets from \`import "~plugins"\` leading its entry file.
import "@api/Settings";

${imports}

const entries = [
${entries}
];

// Names come from the definitions themselves: the build knows folders, the
// runtime knows plugin names.
export default Object.fromEntries(entries.map(({ def }) => [def.name, def]));
export const PluginMeta = Object.fromEntries(
  entries.map(({ def, folder }) => [def.name, { folderName: folder, userPlugin: false }]),
);
export const ExcludedPlugins = {};
`;
}

const virtualPlugin = {
  name: "ion-vencord-virtual",
  setup: (pluginBuild) => {
    pluginBuild.onResolve({ filter: /^~(plugins|git-hash|git-remote)$/ }, (args) => ({
      path: args.path,
      namespace: "ion-virtual",
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "ion-virtual" }, (args) => {
      if (args.path === "~plugins") return { loader: "js", contents: pluginsModule() };
      if (args.path === "~git-hash") {
        return {
          loader: "js",
          contents: `export default ${JSON.stringify(manifest.source.commit)};`,
        };
      }
      return { loader: "js", contents: `export default ${JSON.stringify(ION_REMOTE)};` };
    });
  },
};

const cssPlugin = {
  name: "ion-vencord-css",
  setup: (pluginBuild) => {
    // `./style.css?managed` (upstream's stylePlugin): the module only
    // registers the stylesheet in `window.VencordStyles` — upstream's
    // @api/Styles mounts and unmounts it as the owning plugin starts and
    // stops, which is what "managed" means.
    pluginBuild.onResolve({ filter: /\.css\?managed$/ }, (args) => ({
      namespace: "ion-managed-style",
      path: resolve(args.resolveDir, args.path.split("?")[0]),
    }));
    pluginBuild.onLoad({ filter: /\.css$/, namespace: "ion-managed-style" }, (args) => {
      const css = readFileSync(args.path, "utf8");
      const name = args.path
        .slice(vendorSrc.length + 1)
        .split(sep)
        .join("/");
      return {
        loader: "js",
        contents: [
          `// Mirrors upstream's scripts/build/module/style.js (GPL-3.0-or-later,\n` +
            `// see THIRD_PARTY.md): register the source; @api/Styles owns the DOM.\n` +
            `(window.VencordStyles ??= new Map()).set(${JSON.stringify(name)}, {`,
          `  name: ${JSON.stringify(name)},`,
          `  source: ${JSON.stringify(css)},`,
          `  classNames: {},`,
          `  dom: null,`,
          `});`,
          `export default ${JSON.stringify(name)};`,
        ].join("\n"),
      };
    });
    pluginBuild.onLoad({ filter: /\.css$/, namespace: "file" }, (args) => {
      const css = readFileSync(args.path, "utf8");
      const name = args.path
        .slice(vendorSrc.length + 1)
        .split(sep)
        .join("/");
      return {
        loader: "js",
        contents: [
          `const style = document.createElement("style");`,
          `style.dataset.ionVencord = ${JSON.stringify(name)};`,
          `style.textContent = ${JSON.stringify(css)};`,
          `const mount = () => {`,
          `  const target = document.head ?? document.documentElement;`,
          `  if (!target) return false;`,
          `  target.appendChild(style);`,
          `  return true;`,
          `};`,
          // The shell injects at document_start, before <head> exists.
          `if (!mount()) document.addEventListener("DOMContentLoaded", mount, { once: true });`,
          `export default ${JSON.stringify(name)};`,
        ].join("\n"),
      };
    });
  },
};

/**
 * `file://` raw-text imports (upstream's fileUriPlugin): quotes and code
 * samples a plugin ships beside its sources are read verbatim into a string
 * export. The vendor closure copies those files in; `?minify` and friends
 * are a build-time transform Ion does not need, so they fail loudly rather
 * than silently ship unminified text.
 */
const fileUriPlugin = {
  name: "ion-vencord-file-uri",
  setup: (pluginBuild) => {
    pluginBuild.onResolve({ filter: /^file:\/\/.+$/ }, (args) => ({
      namespace: "ion-file-uri",
      path: args.path,
      pluginData: {
        uri: args.path,
        path: resolve(args.resolveDir, args.path.slice("file://".length).split("?")[0]),
      },
    }));
    pluginBuild.onLoad({ filter: /^file:\/\/.+$/, namespace: "ion-file-uri" }, (args) => {
      const { uri, path } = args.pluginData;
      const params = new URL(uri).searchParams;
      if (params.has("minify")) {
        return {
          errors: [{ text: `file:// minify is not implemented: ${uri} — inline the text instead` }],
        };
      }
      let content = params.has("base64")
        ? readFileSync(path).toString("base64")
        : readFileSync(path, "utf8");
      if (params.get("trim") !== "false" && !params.has("base64")) content = content.trimEnd();
      return { loader: "js", contents: `export default ${JSON.stringify(content)};` };
    });
  },
};

/**
 * The api barrel's source — external artifact stubs read their export keys
 * from it so a vendor refresh that reshapes `@api` fails at build time.
 */
const apiIndexSource = readFileSync(join(vendorSrc, "api", "index.ts"), "utf8");

/** Every key `@api` is exported under (`MessageEvents`, `PluginManager`, ...). */
function apiBarrelKeys() {
  const keys = new Set();
  for (const match of apiIndexSource.matchAll(/export\s+\*\s+as\s+(\w+)\s+from/g)) {
    keys.add(match[1]);
  }
  for (const match of apiIndexSource.matchAll(/export\s+const\s+(\w+)\s*=\s*\$\w+/g)) {
    keys.add(match[1]);
  }
  return [...keys];
}

/** The barrel key one api module is exposed under (`MessageEvents` → `MessageEvents`), or null. */
function apiBarrelKey(subpath) {
  const star = apiIndexSource.match(
    new RegExp(`export\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+"\\./${subpath}"`),
  );
  if (star) return star[1];
  const alias = apiIndexSource.match(
    new RegExp(`import\\s+\\*\\s+as\\s+\\$(\\w+)\\s+from\\s+"\\./${subpath}"`),
  )?.[1];
  if (alias === undefined) return null;
  return (
    apiIndexSource.match(new RegExp(`export\\s+const\\s+(\\w+)\\s*=\\s*\\$${alias}\\b`))?.[1] ??
    null
  );
}

/**
 * Runtime export names of a vendored api module. Stubs must declare names
 * statically (the artifact does `import { x } from "@api/..."`), so a name
 * these passes miss fails the esbuild build — never a silent undefined at
 * runtime. Type-only exports are intentionally excluded (`export type`,
 * `export interface`, `export { type X }`); `export * from` chains are
 * followed because their names land in the same namespace.
 */
function runtimeExportNames(file, visited = new Set()) {
  if (visited.has(file)) return [];
  visited.add(file);
  const source = readFileSync(file, "utf8");
  const names = new Set();
  for (const match of source.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const(?:\s+enum)?|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const spec of match[1].split(",")) {
      const name = spec
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(/export\s+\*\s+from\s+"([^"]+)"/g)) {
    const target = followStarExport(file, match[1]);
    if (target !== null) {
      for (const name of runtimeExportNames(target, visited)) names.add(name);
    }
  }
  return [...names];
}

/** Where one `export * from` specifier points, or null when unresolvable. */
function followStarExport(fromFile, specifier) {
  if (specifier.startsWith(".")) return probe(resolve(dirname(fromFile), specifier));
  if (specifier === "@vencord/discord-types") {
    return probe(join(vendorRoot, "packages", "discord-types", "index"));
  }
  if (specifier.startsWith("@vencord/discord-types/")) {
    return probe(
      join(
        vendorRoot,
        "packages",
        "discord-types",
        specifier.slice("@vencord/discord-types/".length),
      ),
    );
  }
  return null;
}

/** The `@api` stub for one specifier, or null when it cannot be mapped. */
function apiExternalTarget(specifier) {
  if (specifier === "@api" || specifier === "@api/index") {
    return { keyParts: [], file: join(vendorSrc, "api", "index.ts") };
  }
  const segments = specifier.slice("@api/".length).split("/");
  if (segments.length > 2) return null; // deeper chains: no real case yet — inline
  const top = probe(join(vendorSrc, "api", segments[0]));
  if (top === null) return null;
  const key = apiBarrelKey(segments[0]);
  if (key === null) return null;
  if (segments.length === 1) return { keyParts: [key], file: top };

  // `@api/Scope/nested`: only external when the scope's own index exposes
  // the nested file — either as a namespace (`export * as nested`) or
  // flattened (`export * from`). When neither holds (the barrel simply
  // never re-exports it, e.g. SettingsSync has no index at all), returning
  // null falls back to inlining: the module's state is not shared with the
  // runtime, but it is not reachable through the runtime either.
  const scopeIndex = probe(join(vendorSrc, "api", segments[0], "index"));
  if (scopeIndex === null) return null;
  const nestedFile = probe(join(vendorSrc, "api", segments[0], segments[1]));
  if (nestedFile === null) return null;
  const indexSource = readFileSync(scopeIndex, "utf8");
  const nested = segments[1];
  const asNamespace =
    new RegExp(`export\\s+\\*\\s+as\\s+${nested}\\s+from\\s+"\\./${nested}"`).test(indexSource) ||
    namespaceConstExport(indexSource, nested) !== null;
  if (asNamespace) return { keyParts: [key, nested], file: nestedFile };
  const flattened = new RegExp(`export\\s+\\*\\s+from\\s+"\\./${nested}"`).test(indexSource);
  if (flattened) return { keyParts: [key], file: nestedFile };
  return null;
}

/** `import * as $X from "./nested"` + `export const nested = $X`, or null. */
function namespaceConstExport(indexSource, nested) {
  const alias = indexSource.match(
    new RegExp(`import\\s+\\*\\s+as\\s+\\$(\\w+)\\s+from\\s+"\\./${nested}"`),
  )?.[1];
  if (alias === undefined) return null;
  return indexSource.match(new RegExp(`export\\s+const\\s+${nested}\\s*=\\s*\\$${alias}\\b`));
}

/** The stub source for one `@api` specifier, or null when it must inline. */
function apiStubModule(specifier) {
  const target = apiExternalTarget(specifier);
  if (target === null) return null;
  const guard = [
    `const Api = globalThis.Vencord.Api;`,
    `if (!Api) throw new Error("[ion] compat-vencord runtime missing: window.Vencord.Api");`,
  ].join("\n");
  const names = target.keyParts.length === 0 ? apiBarrelKeys() : runtimeExportNames(target.file);
  const modExpr =
    target.keyParts.length === 0
      ? "Api"
      : target.keyParts.reduce(
          (expression, part) => `${expression}[${JSON.stringify(part)}]`,
          "Api",
        );
  const destructure = names.length > 0 ? `export const { ${names.join(", ")} } = mod;\n` : "";
  return `${guard}
const mod = ${modExpr};
if (!mod) throw new Error("[ion] compat-vencord runtime Api is missing ${specifier}");
export default mod;
${destructure}`;
}

/**
 * Artifact-only resolution: the `@api` scope stays OUT of the bundle and
 * reads the running compat-vencord runtime instead, and the entry hands the
 * compiled definition to `window.__ION_VENCORD_PLUGIN__` for
 * `Vencord.registerPluginDefinition`. Everything else (utils, components,
 * webpack shims) inlines — the shims only wrap window.__ION__, so their
 * copies still share core's state.
 */
const artifactPlugin = {
  name: "ion-vencord-artifact",
  setup: (pluginBuild) => {
    pluginBuild.onResolve({ filter: /^@api(\/|$)/ }, (args) => {
      // Deep imports the barrel never exposes resolve normally (inlined by
      // aliasPlugin below) — only genuinely shared modules become stubs.
      if (apiExternalTarget(args.path) === null) return null;
      return { path: args.path, namespace: "ion-api-external" };
    });
    pluginBuild.onLoad({ filter: /.*/, namespace: "ion-api-external" }, (args) => {
      const contents = apiStubModule(args.path);
      if (contents === null) {
        return {
          errors: [
            {
              text: `cannot externalize ${args.path}: no vendored api module or barrel key — update scripts/build.mjs after a vendor refresh`,
            },
          ],
        };
      }
      return { loader: "js", contents };
    });
    pluginBuild.onResolve({ filter: /^ion-artifact:/ }, (args) => ({
      path: args.path,
      namespace: "ion-artifact-entry",
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "ion-artifact-entry" }, (args) => {
      const folder = args.path.slice("ion-artifact:".length);
      return {
        loader: "js",
        contents: `import def from "@plugins/${folder}";\nglobalThis.__ION_VENCORD_PLUGIN__ = def;\n`,
      };
    });
  },
};

const banner = `/*
 * Ion compat-vencord bundle — https://github.com/Wester4253/Ion
 *
 * Bundles the vendored Vencord sources of the ${acceptance.length} acceptance plugins:
 * Vencord ${manifest.source.version} (${manifest.source.commit}),
 * Copyright (c) Vendicated and contributors, GPL-3.0-or-later.
 * Verbatim copies are pinned by vendor/vencord/MANIFEST.json; @webpack and
 * @webpack/patcher are Ion shims as recorded there. See THIRD_PARTY.md.
 */`;

const define = {
  // Upstream's build flags for the vesktop renderer target.
  IS_VESKTOP: "true",
  IS_DISCORD_DESKTOP: "false",
  IS_WEB: "false",
  IS_EXTENSION: "false",
  IS_USERSCRIPT: "false",
  IS_DEV: "false",
  IS_REPORTER: "false",
  IS_ANTI_CRASH_TEST: "false",
  IS_STANDALONE: "true",
  IS_UPDATER_DISABLED: "true",
  VERSION: JSON.stringify(manifest.source.version),
  BUILD_TIMESTAMP: JSON.stringify(Date.now()),
};

const sharedOptions = {
  absWorkingDir: packageDir,
  // The package tsconfig enables verbatimModuleSyntax (our own sources use
  // `import type` diligently); the vendored upstream sources predate it and
  // import types through value syntax, which esbuild must still erase.
  tsconfig: join(packageDir, "tsconfig.build.json"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2023",
  legalComments: "inline",
  jsx: "transform",
  jsxFactory: "VencordCreateElement",
  jsxFragment: "VencordFragment",
  inject: [join(shimsDir, "reactInject.ts")],
  define,
  logLevel: "warning",
};

const options = {
  ...sharedOptions,
  entryPoints: [join(packageDir, "src", "index.ts")],
  outfile: join(packageDir, "dist", "index.js"),
  globalName: "Vencord",
  // Inline: the shell evaluates the bundle as injected script text, where a
  // relative sourceMappingURL would resolve against the page, not the file.
  sourcemap: "inline",
  banner: { js: banner },
  // No `sourceURL` footer: the shell evaluates this bundle concatenated with
  // core, ui, and the other adapters, and V8 takes the *last* `sourceURL` in
  // the injected source as the name of every frame. Naming this file here
  // would attribute every adapter's stack to the Vencord bundle — which is
  // what the harness reports did until the shell started appending
  // `ion://ion/injection.js` last (see `loadCoreBundle`). The per-plugin
  // Ion Index artifacts below keep theirs: they are evaluated on their own.
  plugins: [aliasPlugin, virtualPlugin, cssPlugin, fileUriPlugin],
};

const artifactsDir = join(packageDir, "dist", "artifacts");

function artifactBanner(entry) {
  return `/*
 * Ion Index compiled Vencord plugin — https://github.com/Wester4253/Ion
 *
 * ${entry.name} (vendor/vencord/src/plugins/${entry.folder})
 * Compiled from Vencord ${manifest.source.version} (${manifest.source.commit}),
 * Copyright (c) Vendicated and contributors, GPL-3.0-or-later.
 * Loads against a running compat-vencord runtime (window.Vencord.Api);
 * hashes and provenance: dist/artifacts/index.json. See THIRD_PARTY.md.
 */`;
}

function artifactOptions(entry) {
  const slug = entry.folder.replace(/\//g, "__");
  return {
    ...sharedOptions,
    entryPoints: [`ion-artifact:${entry.folder}`],
    outfile: join(artifactsDir, `${slug}.js`),
    // No map: artifacts are downloaded files, and the Ion Index verifies
    // them by hash — see BUILD_TIMESTAMP below.
    sourcemap: false,
    banner: { js: artifactBanner(entry) },
    footer: { js: `//# sourceURL=ion://index/vencord/${slug}.js` },
    // Pinned so repeated builds of unchanged sources hash identically.
    define: { ...define, BUILD_TIMESTAMP: JSON.stringify("0") },
    plugins: [artifactPlugin, aliasPlugin, virtualPlugin, cssPlugin, fileUriPlugin],
  };
}

/**
 * Compile one self-contained artifact per acceptance plugin for the Ion
 * Index (cloud compilation per AGENTS.md: CI runs this build and publishes
 * the results; the app downloads a file and calls
 * `Vencord.registerPluginDefinition(window.__ION_VENCORD_PLUGIN__)`).
 * Skipped in watch mode — it is a publishing step, not a dev loop.
 */
async function buildArtifacts() {
  mkdirSync(artifactsDir, { recursive: true });
  const published = [];
  for (const entry of acceptance) {
    const artifact = artifactOptions(entry);
    await build(artifact);
    const bytes = readFileSync(artifact.outfile);
    published.push({
      name: entry.name,
      group: entry.group,
      folder: entry.folder,
      file: `${entry.folder.replace(/\//g, "__")}.js`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...(entry.note === undefined ? {} : { note: entry.note }),
    });
  }
  const index = {
    format: "ion-index/vencord-artifacts/v1",
    upstream: {
      repository: manifest.source.repository,
      commit: manifest.source.commit,
      version: manifest.source.version,
    },
    generatedAt: new Date().toISOString(),
    plugins: published,
  };
  writeFileSync(join(artifactsDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(
    `[@ion/compat-vencord] ${published.length} artifacts → dist/artifacts (index.json)\n`,
  );
}

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  process.stdout.write("[@ion/compat-vencord] watching dist/index.js\n");
} else {
  await build(options);
  await buildArtifacts();
}
