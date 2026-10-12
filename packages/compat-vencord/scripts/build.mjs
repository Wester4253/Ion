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

import { existsSync, readFileSync, statSync } from "node:fs";
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

  return `${imports}

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
    pluginBuild.onLoad({ filter: /\.css$/ }, (args) => {
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

const banner = `/*
 * Ion compat-vencord bundle — https://github.com/Wester4253/Ion
 *
 * Bundles the vendored Vencord sources of the 32 acceptance plugins:
 * Vencord ${manifest.source.version} (${manifest.source.commit}),
 * Copyright (c) Vendicated and contributors, GPL-3.0-or-later.
 * Verbatim copies are pinned by vendor/vencord/MANIFEST.json; @webpack and
 * @webpack/patcher are Ion shims as recorded there. See THIRD_PARTY.md.
 */`;

const options = {
  absWorkingDir: packageDir,
  // The package tsconfig enables verbatimModuleSyntax (our own sources use
  // `import type` diligently); the vendored upstream sources predate it and
  // import types through value syntax, which esbuild must still erase.
  tsconfig: join(packageDir, "tsconfig.build.json"),
  entryPoints: [join(packageDir, "src", "index.ts")],
  outfile: join(packageDir, "dist", "index.js"),
  bundle: true,
  format: "iife",
  globalName: "Vencord",
  platform: "browser",
  target: "es2023",
  // Inline: the shell evaluates the bundle as injected script text, where a
  // relative sourceMappingURL would resolve against the page, not the file.
  sourcemap: "inline",
  legalComments: "inline",
  banner: { js: banner },
  footer: { js: "//# sourceURL=ion://compat-vencord/index.js" },
  jsx: "transform",
  jsxFactory: "VencordCreateElement",
  jsxFragment: "VencordFragment",
  inject: [join(shimsDir, "reactInject.ts")],
  define: {
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
  },
  plugins: [aliasPlugin, virtualPlugin, cssPlugin],
  logLevel: "warning",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  process.stdout.write("[@ion/compat-vencord] watching dist/index.js\n");
} else {
  await build(options);
}
