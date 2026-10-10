/**
 * Path scoping for the renderer-facing filesystem bridge.
 *
 * The renderer only ever sends relative paths; this module resolves them
 * inside a root directory and refuses anything that escapes it. Pure and
 * unit-tested (Windows and POSIX separators both).
 */

import { isAbsolute, resolve, sep } from "node:path";

/**
 * Resolve `relative` against `root`.
 *
 * Returns the absolute path, or null when the input is absolute, contains a
 * NUL byte, or would land outside `root` (`..` traversal, symlink-free
 * textual check).
 */
export function resolveScopedPath(root: string, relative: string): string | null {
  if (relative.includes("\0")) return null;
  if (isAbsolute(relative)) return null;

  const resolved = resolve(root, relative);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}
