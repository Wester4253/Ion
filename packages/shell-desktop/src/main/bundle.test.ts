import { describe, expect, test } from "vitest";

import {
  compatBdBundleCandidates,
  compatShelterBundleCandidates,
  compatVencordBundleCandidates,
  coreBundleCandidates,
  loadCoreBundle,
  uiBundleCandidates,
} from "./bundle";

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

describe("uiBundleCandidates", () => {
  test("resolves the sibling workspace bundle", () => {
    const [only] = uiBundleCandidates(undefined, "/repo/packages/shell-desktop/dist");
    expect(only).toMatch(/packages\/ui\/dist\/index\.js$/);
  });

  test("env override takes priority", () => {
    const [first] = uiBundleCandidates("/opt/ion/ui.js", "/repo/packages/shell-desktop/dist");
    expect(first).toBe("/opt/ion/ui.js");
  });
});

describe("compatVencordBundleCandidates", () => {
  test("resolves the sibling workspace bundle", () => {
    const [only] = compatVencordBundleCandidates(undefined, "/repo/packages/shell-desktop/dist");
    expect(only).toMatch(/packages\/compat-vencord\/dist\/index\.js$/);
  });

  test("env override takes priority", () => {
    const [first] = compatVencordBundleCandidates(
      "/opt/ion/vc.js",
      "/repo/packages/shell-desktop/dist",
    );
    expect(first).toBe("/opt/ion/vc.js");
  });
});

describe("compatBdBundleCandidates", () => {
  test("resolves the sibling workspace bundle", () => {
    const [only] = compatBdBundleCandidates(undefined, "/repo/packages/shell-desktop/dist");
    expect(only).toMatch(/packages\/compat-bd\/dist\/index\.js$/);
  });

  test("env override takes priority", () => {
    const [first] = compatBdBundleCandidates("/opt/ion/bd.js", "/repo/packages/shell-desktop/dist");
    expect(first).toBe("/opt/ion/bd.js");
  });
});

describe("compatShelterBundleCandidates", () => {
  test("resolves the sibling workspace bundle", () => {
    const [only] = compatShelterBundleCandidates(undefined, "/repo/packages/shell-desktop/dist");
    expect(only).toMatch(/packages\/compat-shelter\/dist\/index\.js$/);
  });

  test("env override takes priority", () => {
    const [first] = compatShelterBundleCandidates(
      "/opt/ion/shelter.js",
      "/repo/packages/shell-desktop/dist",
    );
    expect(first).toBe("/opt/ion/shelter.js");
  });
});

describe("loadCoreBundle", () => {
  const dist = "/repo/packages/shell-desktop/dist";

  test("returns the first readable candidate", () => {
    const result = loadCoreBundle("/opt/ion/core.js", undefined, dist, (file) => {
      if (file === "/opt/ion/core.js") return "code";
      throw new Error("missing");
    });
    expect(result).toEqual({
      ok: true,
      source: "code",
      file: "/opt/ion/core.js",
      optional: [
        { name: "ui", candidates: expect.anything() as string[], loaded: false },
        { name: "compat-vencord", candidates: expect.anything() as string[], loaded: false },
        { name: "compat-bd", candidates: expect.anything() as string[], loaded: false },
        { name: "compat-shelter", candidates: expect.anything() as string[], loaded: false },
      ],
      ui: false,
      compatVencord: false,
      compatBd: false,
      compatShelter: false,
    });
  });

  test("falls through to the workspace bundle", () => {
    const result = loadCoreBundle(undefined, undefined, dist, (file) => {
      if (file.endsWith("core/dist/index.js")) return "workspace code";
      throw new Error("missing");
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("workspace code");
  });

  test("appends the UI bundle after the core bundle", () => {
    const result = loadCoreBundle("/opt/ion/core.js", "/opt/ion/ui.js", dist, (file) => {
      if (file === "/opt/ion/core.js") return "core code";
      if (file === "/opt/ion/ui.js") return "ui code";
      throw new Error("missing");
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ui).toBe(true);
      expect(result.compatVencord).toBe(false);
      expect(result.source).toBe("core code\n;\nui code");
      expect(result.file).toBe("/opt/ion/core.js");
    }
  });

  test("appends the compat-vencord bundle after the UI bundle", () => {
    const result = loadCoreBundle(
      "/opt/ion/core.js",
      "/opt/ion/ui.js",
      dist,
      (file) => {
        if (file === "/opt/ion/core.js") return "core code";
        if (file === "/opt/ion/ui.js") return "ui code";
        if (file === "/opt/ion/vc.js") return "vencord adapter code";
        throw new Error("missing");
      },
      "/opt/ion/vc.js",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ui).toBe(true);
      expect(result.compatVencord).toBe(true);
      expect(result.compatBd).toBe(false);
      expect(result.source).toBe("core code\n;\nui code\n;\nvencord adapter code");
    }
  });

  test("appends the compat-bd bundle after the compat-vencord bundle", () => {
    const result = loadCoreBundle(
      "/opt/ion/core.js",
      "/opt/ion/ui.js",
      dist,
      (file) => {
        if (file === "/opt/ion/core.js") return "core code";
        if (file === "/opt/ion/ui.js") return "ui code";
        if (file === "/opt/ion/vc.js") return "vencord adapter code";
        if (file === "/opt/ion/bd.js") return "bd adapter code";
        throw new Error("missing");
      },
      "/opt/ion/vc.js",
      "/opt/ion/bd.js",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ui).toBe(true);
      expect(result.compatVencord).toBe(true);
      expect(result.compatBd).toBe(true);
      expect(result.source).toBe(
        "core code\n;\nui code\n;\nvencord adapter code\n;\nbd adapter code",
      );
    }
  });

  test("appends the compat-shelter bundle after the other adapters", () => {
    const result = loadCoreBundle(
      "/opt/ion/core.js",
      undefined,
      dist,
      (file) => {
        if (file === "/opt/ion/core.js") return "core code";
        if (file === "/opt/ion/shelter.js") return "shelter adapter code";
        throw new Error("missing");
      },
      undefined,
      undefined,
      "/opt/ion/shelter.js",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ui).toBe(false);
      expect(result.compatVencord).toBe(false);
      expect(result.compatBd).toBe(false);
      expect(result.compatShelter).toBe(true);
      expect(result.source).toBe("core code\n;\nshelter adapter code");
    }
  });

  test("runs core-only when the UI bundle is absent", () => {
    const result = loadCoreBundle("/opt/ion/core.js", "/opt/ion/ui.js", dist, (file) => {
      if (file === "/opt/ion/core.js") return "core code";
      throw new Error("missing");
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ui).toBe(false);
      expect(result.source).toBe("core code");
    }
  });

  test("reports every attempted path and the last reason", () => {
    const result = loadCoreBundle("/opt/ion/core.js", undefined, dist, () => {
      throw new Error("EACCES");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.tried).toHaveLength(2);
      expect(result.reason).toBe("EACCES");
    }
  });

  test("treats an empty bundle as a failure", () => {
    const result = loadCoreBundle("/opt/ion/core.js", undefined, "/repo/d", () => "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });
});
