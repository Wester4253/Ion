import { describe, expect, test } from "vitest";

import { coreBundleCandidates, loadCoreBundle } from "./bundle";

describe("coreBundleCandidates", () => {
  test("resolves the sibling workspace bundle", () => {
    const [only] = coreBundleCandidates(undefined, "/repo/packages/shell-desktop/dist");
    expect(only).toMatch(/packages\/core\/dist\/index\.js$/);
  });

  test("env override takes priority", () => {
    const [first] = coreBundleCandidates("/opt/ion/core.js", "/repo/packages/shell-desktop/dist");
    expect(first).toBe("/opt/ion/core.js");
  });
});

describe("loadCoreBundle", () => {
  test("returns the first readable candidate", () => {
    const result = loadCoreBundle(
      "/opt/ion/core.js",
      "/repo/packages/shell-desktop/dist",
      (file) => {
        if (file === "/opt/ion/core.js") return "code";
        throw new Error("missing");
      },
    );
    expect(result).toEqual({ ok: true, source: "code", file: "/opt/ion/core.js" });
  });

  test("falls through to the workspace bundle", () => {
    const result = loadCoreBundle(undefined, "/repo/packages/shell-desktop/dist", (file) => {
      if (file.endsWith("core/dist/index.js")) return "workspace code";
      throw new Error("missing");
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("workspace code");
  });

  test("reports every attempted path and the last reason", () => {
    const result = loadCoreBundle("/opt/ion/core.js", "/repo/packages/shell-desktop/dist", () => {
      throw new Error("EACCES");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.tried).toHaveLength(2);
      expect(result.reason).toBe("EACCES");
    }
  });

  test("treats an empty bundle as a failure", () => {
    const result = loadCoreBundle("/opt/ion/core.js", "/repo/d", () => "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });
});
