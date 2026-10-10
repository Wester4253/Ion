import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { resolveScopedPath } from "./pathScope";

const root = resolve("/home/user/.config/Ion/ion");

describe("resolveScopedPath", () => {
  test("accepts paths inside the root", () => {
    expect(resolveScopedPath(root, "shell.json")).toBe(resolve(root, "shell.json"));
    expect(resolveScopedPath(root, "plugins/example/index.js")).toBe(
      resolve(root, "plugins/example/index.js"),
    );
    expect(resolveScopedPath(root, "a/../b")).toBe(resolve(root, "b"));
    expect(resolveScopedPath(root, ".")).toBe(root);
    expect(resolveScopedPath(root, "")).toBe(root);
  });

  test("refuses traversal outside the root", () => {
    expect(resolveScopedPath(root, "..")).toBeNull();
    expect(resolveScopedPath(root, "../secrets")).toBeNull();
    expect(resolveScopedPath(root, "plugins/../../..")).toBeNull();
    expect(resolveScopedPath(root, "a/b/../../../outside")).toBeNull();
  });

  test("refuses absolute paths and NUL bytes", () => {
    expect(resolveScopedPath(root, "/etc/passwd")).toBeNull();
    expect(resolveScopedPath(root, resolve(root, "x"))).toBeNull();
    expect(resolveScopedPath(root, "file\0.png")).toBeNull();
  });

  test("refuses sibling prefixes that merely share the root name", () => {
    expect(resolveScopedPath(root, "../ion-evil/x")).toBeNull();
  });
});
