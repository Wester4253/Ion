import * as nodePath from "node:path";
import { describe, expect, test } from "vitest";

import { createPathApi, type PathApi } from "./pathApi";

type FnName = "join" | "normalize" | "dirname" | "basename" | "extname";
type Variadic = (...args: string[]) => string;
type Fns = Record<FnName, Variadic>;

function fnsOf(api: PathApi): Fns {
  return {
    join: api.join,
    normalize: api.normalize,
    dirname: api.dirname,
    basename: api.basename,
    extname: api.extname,
  };
}

function nodeFnsOf(mod: typeof nodePath.posix): Fns {
  return {
    join: (...args) => mod.join(...args),
    normalize: (path) => mod.normalize(path),
    dirname: (path) => mod.dirname(path),
    basename: (path, ext) => mod.basename(path, ext),
    extname: (path) => mod.extname(path),
  };
}

const posix = createPathApi("linux");
const win32 = createPathApi("win32");
const posixFns = fnsOf(posix);
const win32Fns = fnsOf(win32);
const nodePosix = nodeFnsOf(nodePath.posix);
const nodeWin32 = nodeFnsOf(nodePath.win32);

const cases: [fn: FnName, ...args: string[]][] = [
  ["join", "a", "b", "c"],
  ["join", "/a", "", "b"],
  ["join", "a", "../b"],
  ["join", "/a", "../../b"],
  ["normalize", "a/b/../c"],
  ["normalize", "./a//b/"],
  ["normalize", "../.."],
  ["normalize", "/../a"],
  ["normalize", "a/b/"],
  ["dirname", "/a/b/c"],
  ["dirname", "a/b"],
  ["dirname", "a"],
  ["dirname", "/"],
  ["dirname", "."],
  ["basename", "/a/b/file.txt"],
  ["basename", "/a/b/file.txt", ".txt"],
  ["basename", "/a/b/"],
  ["extname", "file.txt"],
  ["extname", "archive.tar.gz"],
  ["extname", "noext"],
  ["extname", ".bashrc"],
  ["extname", "/a/b/index."],
];

const windowsCases: [fn: FnName, ...args: string[]][] = [
  ["join", "C:\\a", "b"],
  ["join", "a", "..\\b"],
  ["normalize", "C:\\a\\..\\b"],
  ["dirname", "C:\\a\\b\\c.txt"],
  ["dirname", "C:\\a"],
  ["basename", "C:\\a\\b\\c.txt"],
  ["basename", "C:\\a\\b\\c.txt", ".txt"],
  ["extname", "C:\\a\\b\\c.txt"],
];

describe("pathApi (posix) matches node:path.posix", () => {
  for (const [fn, ...args] of cases) {
    test(`${fn}(${args.map((a) => JSON.stringify(a)).join(", ")})`, () => {
      expect(posixFns[fn](...args)).toBe(nodePosix[fn](...args));
    });
  }

  test("isAbsolute", () => {
    expect(posix.isAbsolute("/a")).toBe(true);
    expect(posix.isAbsolute("a")).toBe(false);
    expect(posix.isAbsolute("//a")).toBe(true);
  });

  test("parse matches node", () => {
    for (const p of ["/a/b/file.txt", "file.txt", "/x/.hidden", "/x/y.", "/x/", "a/b/"]) {
      expect(posix.parse(p)).toEqual(nodePath.posix.parse(p));
    }
  });

  test("relative matches node", () => {
    const pairs: [string, string][] = [
      ["/a/b", "/a/b/c"],
      ["/a/b/c", "/a/b"],
      ["/a/b", "/a/b"],
      ["/", "/a"],
      ["/a", "/b"],
      ["a/b", "a/b/c/d"],
    ];
    for (const [from, to] of pairs) {
      expect(posix.relative(from, to)).toBe(nodePath.posix.relative(from, to));
    }
  });
});

describe("pathApi (win32) matches node:path.win32", () => {
  for (const [fn, ...args] of windowsCases) {
    test(`${fn}(${args.map((a) => JSON.stringify(a)).join(", ")})`, () => {
      expect(win32Fns[fn](...args)).toBe(nodeWin32[fn](...args));
    });
  }

  test("drive letters and separators", () => {
    expect(win32.isAbsolute("C:\\x")).toBe(true);
    expect(win32.isAbsolute("C:/x")).toBe(true);
    expect(win32.isAbsolute("C:x")).toBe(false);
    expect(win32.isAbsolute("/x")).toBe(true);
    expect(win32.sep).toBe("\\");
    expect(win32.parse("C:\\a\\b.txt")).toEqual(nodePath.win32.parse("C:\\a\\b.txt"));
  });

  test("relative across drives returns the target (like node)", () => {
    expect(win32.relative("C:\\a", "D:\\b")).toBe("D:\\b");
    expect(win32.relative("C:\\a\\b", "C:\\a\\b\\c")).toBe("c");
  });
});
