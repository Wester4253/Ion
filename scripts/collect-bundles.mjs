/**
 * Collects the built bundles into the layout the packaged app expects.
 *
 * The shell loads core, ui and the three compat adapters as sibling bundles.
 * In the repository that is `../core/dist/index.js`; inside a packaged app
 * there is no repository, so each package's build output is copied to
 * `packages/shell-desktop/bundles/<name>/index.js`, which `main/bundle.ts`
 * falls back to (see `packagedCandidate`).
 *
 * This is build output, not source: it is gitignored and rebuilt by every
 * packaging run, so a stale bundle can never ship. Every copy is verified — a
 * missing or empty source is a hard error, because the alternative is an app
 * that silently runs without an adapter.
 */

import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// One level up from `scripts/` is the repository root.
const root = resolve(import.meta.dirname, "..");
const outDir = join(root, "packages", "shell-desktop", "bundles");

/** `name` is what `main/bundle.ts` resolves under `bundles/`. */
const BUNDLES = [
  { name: "core", from: join("packages", "core", "dist", "index.js") },
  { name: "ui", from: join("packages", "ui", "dist", "index.js") },
  { name: "compat-vencord", from: join("packages", "compat-vencord", "dist", "index.js") },
  { name: "compat-bd", from: join("packages", "compat-bd", "dist", "index.js") },
  { name: "compat-shelter", from: join("packages", "compat-shelter", "dist", "index.js") },
];

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function collect() {
  // Start empty: what lands here is what this build produced, so a bundle that
  // stopped being built cannot linger in the app.
  await rm(outDir, { recursive: true, force: true });

  const collected = [];
  for (const bundle of BUNDLES) {
    const source = join(root, bundle.from);
    const bytes = await sizeOf(source);
    if (bytes === 0) {
      throw new Error(`${source} is missing or empty — run "pnpm build" first`);
    }

    const target = join(outDir, bundle.name, "index.js");
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    collected.push({ name: bundle.name, bytes });
  }

  // Sizes are recorded so a package can be checked without unzipping the app.
  await writeFile(
    join(outDir, "manifest.json"),
    `${JSON.stringify({ bundles: collected }, null, 1)}\n`,
    "utf8",
  );

  process.stdout.write(
    `[ion] collected ${collected.length} bundles into packages/shell-desktop/bundles\n`,
  );
}

collect().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
