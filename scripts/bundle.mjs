import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, context } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";

const watch = process.argv.includes("--watch");
const packageDir = process.cwd();
const manifest = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
const bundles = manifest.ion?.bundles ?? [];

const options = bundles.map((bundle) => ({
  absWorkingDir: packageDir,
  entryPoints: [bundle.entry],
  outfile: bundle.outfile,
  bundle: true,
  sourcemap: true,
  target: "es2023",
  platform: bundle.platform ?? "browser",
  format: bundle.format ?? "esm",
  external: bundle.external ?? [],
  // JSX support for packages/ui; plain-TS bundles never see these.
  ...(bundle.jsx === undefined ? {} : { jsx: bundle.jsx }),
  ...(bundle.jsxImportSource === undefined ? {} : { jsxImportSource: bundle.jsxImportSource }),
  // Solid JSX (compat-shelter, and any dependency that ships JSX) is
  // compiled by babel-preset-solid before esbuild parses it: Solid needs
  // its own transform, which esbuild's built-in JSX handling does not do.
  // Mutually exclusive with the `jsx` options above — babel emits plain JS.
  ...(bundle.solid === true ? { plugins: [solidPlugin()] } : {}),
  logLevel: "warning",
}));

if (watch) {
  const contexts = await Promise.all(options.map((option) => context(option)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  process.stdout.write(`[${manifest.name}] watching ${bundles.length} bundle(s)\n`);
} else {
  await Promise.all(options.map((option) => build(option)));
}
