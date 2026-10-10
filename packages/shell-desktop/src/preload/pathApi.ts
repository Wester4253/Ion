/**
 * A dependency-free subset of Node's `path` module for the require bridge.
 *
 * The sandboxed preload cannot load `node:path`, and plugin code expects
 * `require("path")` to work, so the common operations are reimplemented
 * here with the platform injected for testability. Behavior follows Node's
 * documented semantics for both POSIX and Windows separators.
 *
 * Everything is a plain function closing over platform state — never a
 * receiver-bound method — so the object is safe to destructure.
 */

export interface PathApi {
  readonly sep: string;
  join: (...parts: string[]) => string;
  normalize: (path: string) => string;
  dirname: (path: string) => string;
  basename: (path: string, ext?: string) => string;
  extname: (path: string) => string;
  isAbsolute: (path: string) => boolean;
  parse: (path: string) => { root: string; dir: string; base: string; name: string; ext: string };
  relative: (from: string, to: string) => string;
}

type Platform = NodeJS.Platform;

const TRAILING_SEPS = /[\\/]+$/;

export function createPathApi(platform: Platform): PathApi {
  const isWindows = platform === "win32";
  const sep = isWindows ? "\\" : "/";
  const sepPattern = isWindows ? /[\\/]+/ : /\/+/;

  function splitRoot(path: string): { root: string; rest: string } {
    if (isWindows) {
      const drive = /^([a-zA-Z]:)[\\/]/.exec(path)?.[1];
      if (drive !== undefined)
        return { root: `${drive}${sep}`, rest: path.slice(drive.length + 1) };
      if (path.startsWith("\\\\")) {
        // UNC: \\server\share\...
        const withoutPrefix = path.slice(2);
        const parts = withoutPrefix.split(sepPattern);
        const server = parts.shift() ?? "";
        const share = parts.shift() ?? "";
        return { root: `\\\\${server}${sep}${share}${sep}`, rest: parts.join(sep) };
      }
      if (path.startsWith("\\") || path.startsWith("/")) return { root: sep, rest: path.slice(1) };
      return { root: "", rest: path };
    }
    if (path.startsWith("/")) return { root: "/", rest: path.slice(1) };
    return { root: "", rest: path };
  }

  function normalizeSegments(path: string, keepTrailing: boolean): string {
    const { root, rest } = splitRoot(path);
    const segments: string[] = [];
    for (const segment of rest.split(sepPattern)) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        const last = segments[segments.length - 1];
        if (segments.length > 0 && last !== "..") {
          segments.pop();
        } else if (!root) {
          segments.push("..");
        }
        continue;
      }
      segments.push(segment);
    }
    const joined = segments.join(sep);
    let result = root + joined;
    if (keepTrailing && joined && !result.endsWith(sep)) result += sep;
    if (!result) result = root || ".";
    return result;
  }

  function lastSepIndex(path: string): number {
    return Math.max(path.lastIndexOf("/"), isWindows ? path.lastIndexOf("\\") : -1);
  }

  function normalizeOf(path: string): string {
    return normalizeSegments(path, path.endsWith(sep) || path.endsWith("/"));
  }

  function dirnameOf(path: string): string {
    const { root } = splitRoot(path);
    const trimmed = path.replace(TRAILING_SEPS, "");
    if (trimmed === "") return root || ".";
    const idx = lastSepIndex(trimmed);
    if (idx < 0) return ".";
    if (idx === 0) return root || sep;
    const dir = trimmed.slice(0, idx);
    const rootWithoutSep = root.replace(TRAILING_SEPS, "");
    if (root && dir === rootWithoutSep) return root;
    return dir;
  }

  function basenameOf(path: string, ext?: string): string {
    const trimmed = path.replace(TRAILING_SEPS, "");
    let base = trimmed.slice(lastSepIndex(trimmed) + 1);
    if (ext && ext.length > 0 && base.endsWith(ext) && base !== ext) {
      base = base.slice(0, -ext.length);
    }
    return base;
  }

  function extnameOf(path: string): string {
    const base = basenameOf(path);
    const idx = base.lastIndexOf(".");
    if (idx <= 0) return "";
    return base.slice(idx);
  }

  function parseOf(path: string): {
    root: string;
    dir: string;
    base: string;
    name: string;
    ext: string;
  } {
    const { root } = splitRoot(path);
    const trimmed = path.replace(TRAILING_SEPS, "");
    const idx = lastSepIndex(trimmed);

    // Node: dir is "" for bare relative names, the root for root-adjacent
    // names ("/x" -> "/"), and the parent otherwise.
    let dir = idx >= 0 ? trimmed.slice(0, idx) : "";
    const rootWithoutSep = root.replace(TRAILING_SEPS, "");
    if (dir === "" && root) dir = root;
    else if (root && dir === rootWithoutSep) dir = root;

    const base = basenameOf(path);
    const ext = extnameOf(path);
    return { root, dir, base, name: ext ? base.slice(0, -ext.length) : base, ext };
  }

  return {
    sep,

    join: (...parts: string[]): string => {
      const filtered = parts.filter((part) => part.length > 0);
      if (filtered.length === 0) return ".";
      return normalizeSegments(filtered.join(sep), false);
    },

    normalize: normalizeOf,

    isAbsolute: (path: string): boolean => splitRoot(path).root !== "",

    dirname: dirnameOf,
    basename: basenameOf,
    extname: extnameOf,
    parse: parseOf,

    relative: (from: string, to: string): string => {
      const fromNorm = normalizeOf(from);
      const toNorm = normalizeOf(to);
      if (fromNorm === toNorm) return "";

      const fromRoot = splitRoot(fromNorm).root;
      const toRoot = splitRoot(toNorm).root;
      if (fromRoot.toLowerCase() !== toRoot.toLowerCase() || (isWindows && fromRoot === "")) {
        // Different roots (or Windows drive letters): Node returns the target.
        return toNorm;
      }

      const fromParts = fromNorm.slice(fromRoot.length).split(sepPattern).filter(Boolean);
      const toParts = toNorm.slice(toRoot.length).split(sepPattern).filter(Boolean);

      let common = 0;
      while (
        common < fromParts.length &&
        common < toParts.length &&
        fromParts[common] === toParts[common]
      ) {
        common += 1;
      }
      const up = Array.from({ length: fromParts.length - common }, () => "..");
      const down = toParts.slice(common);
      return [...up, ...down].join(sep);
    },
  };
}
