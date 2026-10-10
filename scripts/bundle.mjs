import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, context } from "esbuild";

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
  logLevel: "warning",
}));

if (watch) {
  const contexts = await Promise.all(options.map((option) => context(option)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  process.stdout.write(`[${manifest.name}] watching ${bundles.length} bundle(s)\n`);
} else {
  await Promise.all(options.map((option) => build(option)));
}
