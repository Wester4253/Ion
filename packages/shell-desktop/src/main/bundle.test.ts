import { describe, expect, test } from "vitest";

import {
  compatBdBundleCandidates,
  compatShelterBundleCandidates,
  compatVencordBundleCandidates,
  coreBundleCandidates,
  INJECTION_SOURCE_URL,
  loadCoreBundle,
  uiBundleCandidates,
} from "./bundle";

/** What `loadCoreBundle` returns for the given concatenation of bundles. */
function injected(...bundles: string[]): string {
  return `${bundles.join("\n;\n")}\n//# sourceURL=${INJECTION_SOURCE_URL}\n`;
}

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

describe("packaged bundle candidates", () => {
  test("every candidate helper also offers the packaged path", () => {
    const dist = "/repo/packages/shell-desktop/dist";
    for (const [name, candidates] of [
      ["core", coreBundleCandidates(undefined, dist)],
      ["ui", uiBundleCandidates(undefined, dist)],
      ["compat-vencord", compatVencordBundleCandidates(undefined, dist)],
      ["compat-bd", compatBdBundleCandidates(undefined, dist)],
      ["compat-shelter", compatShelterBundleCandidates(undefined, dist)],
    ] as const) {
      expect(candidates.at(-1)).toBe(`/repo/packages/shell-desktop/bundles/${name}/index.js`);
    }
  });

  test("the dev sibling stays ahead of the packaged path, and the env override first", () => {
    const dist = "/repo/packages/shell-desktop/dist";
    const candidates = coreBundleCandidates("/opt/ion/core.js", dist);
    expect(candidates[0]).toBe("/opt/ion/core.js");
    expect(candidates).toContain("/repo/packages/core/dist/index.js");
    expect(candidates.at(-1)).toBe("/repo/packages/shell-desktop/bundles/core/index.js");
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
      source: injected("code"),
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
    if (result.ok) expect(result.source).toBe(injected("workspace code"));
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
      expect(result.source).toBe(injected("core code", "ui code"));
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
      expect(result.source).toBe(injected("core code", "ui code", "vencord adapter code"));
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
        injected("core code", "ui code", "vencord adapter code", "bd adapter code"),
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
      expect(result.source).toBe(injected("core code", "shelter adapter code"));
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
      expect(result.source).toBe(injected("core code"));
    }
  });

  test("names the whole injection with one trailing sourceURL", () => {
    // V8 keeps the *last* sourceURL in a script, so the shell's marker has to
    // come after every bundle — otherwise whichever adapter happens to end
    // with its own name would claim every frame, which is what the harness
    // reports did for shelter failures before this.
    const result = loadCoreBundle("/opt/ion/core.js", undefined, dist, (file) => {
      if (file === "/opt/ion/core.js") return "code\n//# sourceURL=ion://compat-vencord/index.js";
      throw new Error("missing");
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.endsWith(`//# sourceURL=${INJECTION_SOURCE_URL}\n`)).toBe(true);
    }
  });

  test("reports every attempted path and the last reason", () => {
    const result = loadCoreBundle("/opt/ion/core.js", undefined, dist, () => {
      throw new Error("EACCES");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The core bundle is loaded first; it reports its env override, its dev
      // sibling and its packaged candidate, and a failure there stops the run
      // before any optional bundle is attempted.
      expect(result.tried).toHaveLength(3);
      expect(result.reason).toBe("EACCES");
    }
  });

  test("treats an empty bundle as a failure", () => {
    const result = loadCoreBundle("/opt/ion/core.js", undefined, "/repo/d", () => "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });
});
