/**
 * Builds the Arch package from the local working tree.
 *
 * `makepkg` takes *files* as sources, so this packs the working tree into a
 * tarball whose top-level directory is `ion` (matching the PKGBUILD's pkgbase),
 * copies the packaging files next to it, builds, and moves the resulting
 * package out. The tarball excludes everything the build regenerates, so a
 * stale `dist/` or a half-finished `release/` cannot leak into a package.
 *
 * The result can be installed with `pacman -U` and inspected with
 * `pacman -Qip/-Qlp`; `--install` does the install itself (needs sudo).
 *
 * AUR submission is packaging/{PKGBUILD,ion.install,ion.desktop,ion.appdata.xml}
 * plus the .SRCINFO this writes with makepkg's own `--printsrcinfo` — not a
 * hand-rolled parser, which cannot tell a dependency from a description.
 *
 * Usage: node scripts/package-arch.mjs [--install]
 */

import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packaging = join(root, "packaging");
// Outside the repository: makepkg's tree is a full second copy of the sources,
// and inside the repo it would be linted, typechecked and (before it was
// ignored) committed.
const buildDir = resolve(process.env.ION_ARCH_BUILD_DIR ?? join(tmpdir(), "ion-arch-build"));
const tarball = join(buildDir, "ion.src.tar.gz");

/** Directories the build produces itself; packing them wastes space and risks staleness. */
const PRUNED = [
  "node_modules",
  ".git",
  "release",
  ".arch-pkg",
  "compat-runs",
  "dist",
  "out",
  ".turbo",
];

/**
 * Everything the build regenerates or never ships. `packaging/` is kept — the
 * desktop entry and the AppStream metadata are installed from it — but the
 * packages it produced are not, or the next build would pack its own output.
 */
const TAR_EXCLUDES = PRUNED.flatMap((pattern) => [
  `--exclude=./${pattern}`,
  `--exclude=*/${pattern}`,
]).concat([
  "--exclude=./packaging/*.pkg.tar.zst",
  "--exclude=./packaging/*.AppImage",
  "--exclude=./packaging/*.deb",
]);

const sh = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` exited ${String(result.status)}`);
  }
  return result;
};

async function packSources() {
  await rm(tarball, { force: true });
  // `--transform` prefixes every entry with `ion/`, so extracting lands in
  // `$srcdir/ion` — the pkgbase the PKGBUILD's build() cd's into.
  sh("tar", ["czf", tarball, ...TAR_EXCLUDES, "--transform", "s,^\\./,ion/,", "."]);
}

async function main() {
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });

  await packSources();

  for (const file of ["PKGBUILD", "ion.install", "ion.desktop", "ion.appdata.xml"]) {
    await copyFile(join(packaging, file), join(buildDir, file));
  }

  // `--nodeps` is for local verification only: it skips makepkg's dependency
  // resolution, which is a fact about the *builder's* machine (pnpm is a user
  // install here, not a pacman package), and the package it produces is the
  // same one a normal `makepkg -si` would. `ION_SRC` gives pkgver the git
  // history, which the tarball does not carry.
  sh("makepkg", ["-C", "-f", "--skippgpcheck", "--nodeps"], {
    cwd: buildDir,
    env: { ION_TARBALL: tarball, ION_SRC: root },
  });

  const built = (await readdir(buildDir)).filter((name) => name.endsWith(".pkg.tar.zst"));
  if (built.length === 0) throw new Error("makepkg produced no package");

  for (const name of built) {
    await copyFile(join(buildDir, name), join(packaging, name));
    process.stdout.write(`[ion] ${name} → packaging/${name}\n`);
  }

  await writeSrcinfo();

  if (process.argv.includes("--install")) {
    sh("pacman", ["-U", "--noconfirm", ...built.map((name) => join(packaging, name))]);
  }
}

/** Writes packaging/.SRCINFO from the PKGBUILD, the way AUR expects it. */
async function writeSrcinfo() {
  const result = spawnSync("makepkg", ["--printsrcinfo"], { cwd: buildDir, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`could not read the package metadata: ${result.stderr}`);
  }
  // makepkg prints tab-indented lines; .SRCINFO is the same text without them.
  const sourceinfo = result.stdout.replace(/^\t/gm, "");
  if (!sourceinfo.includes("pkgbase = ion")) {
    throw new Error(".SRCINFO came back without the package identity");
  }
  await writeFile(join(packaging, ".SRCINFO"), sourceinfo);
  process.stdout.write("[ion] wrote packaging/.SRCINFO\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
