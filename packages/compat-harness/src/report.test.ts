import { describe, expect, test } from "vitest";

import { analyze, type AcceptanceEntry, type SmokeReport, TIER2_MIN_SOAK_MS } from "./report";

const ACCEPTANCE: readonly AcceptanceEntry[] = [
  { group: "A", folder: "_api/commands", name: "CommandsAPI" },
  { group: "D", folder: "petpet", name: "petpet" },
  { group: "D", folder: "fakeNitro", name: "FakeNitro" },
];

const OK = {
  session: "logged-out",
  settleMs: TIER2_MIN_SOAK_MS,
  pluginsStatus: {
    status: { registered: 3, started: 3, failed: 0 },
    ids: ["CommandsAPI:started", "petpet:started", "FakeNitro:started"],
    failures: [],
  },
  rendererErrors: [],
  expectedErrors: {},
  warnings: [],
  patchStats: {},
} satisfies SmokeReport;

const OPTIONS = {
  generatedAt: "2026-10-12T00:00:00.000Z",
  ecosystem: "vencord",
  upstream: "1.15.11 (16ec4ea)",
} as const;

function plugin(report: ReturnType<typeof analyze>, name: string) {
  const found = report.plugins.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe("analyze", () => {
  test("scores a clean run as pass with Tier 2 measured", () => {
    const report = analyze(OK, ACCEPTANCE, OPTIONS);
    expect(report.summary).toEqual({ total: 3, pass: 3, warnings: 0, fail: 0, deferred: 0 });
    expect(report.runHealthy).toBe(true);
    expect(report.meta.tier2Run).toBe(true);
    expect(plugin(report, "FakeNitro").tier2).toBe("pass");
  });

  test("marks Tier 2 not-run below the soak minimum", () => {
    const report = analyze({ ...OK, settleMs: 30_000 }, ACCEPTANCE, OPTIONS);
    expect(report.meta.tier2Run).toBe(false);
    expect(plugin(report, "petpet").tier1).toBe("pass");
    expect(plugin(report, "petpet").tier2).toBe("not-run");
    expect(report.summary.fail).toBe(0);
  });

  test("fails a plugin that never registered", () => {
    const report = analyze(
      { ...OK, pluginsStatus: { ...OK.pluginsStatus, ids: ["CommandsAPI:started"] } },
      ACCEPTANCE,
      OPTIONS,
    );
    const petpet = plugin(report, "petpet");
    expect(petpet.tier1).toBe("fail");
    expect(petpet.status).toBe("fail");
    expect(petpet.reason).toMatch(/did not register/);
    expect(report.summary.fail).toBe(2);
  });

  test("resolves a space-named entry to the adapter's underscored id", () => {
    // The vencord adapter replaces whitespace runs in plugin names with
    // underscores when it registers them; a name like
    // "WebRichPresence (arRPC)" must still find its recorded state.
    const acceptance: readonly AcceptanceEntry[] = [
      { group: "D", folder: "arRPC.web", name: "WebRichPresence (arRPC)" },
    ];
    const report = analyze(
      {
        ...OK,
        pluginsStatus: {
          status: { registered: 1, started: 1, failed: 0 },
          ids: ["WebRichPresence_(arRPC):started"],
          failures: [],
        },
      },
      acceptance,
      OPTIONS,
    );
    expect(plugin(report, "WebRichPresence (arRPC)").tier1).toBe("pass");
    expect(report.summary.fail).toBe(0);
  });

  test("fails a plugin whose start threw, with its error as the reason", () => {
    const report = analyze(
      {
        ...OK,
        pluginsStatus: {
          status: { registered: 3, started: 2, failed: 1 },
          ids: ["CommandsAPI:started", "petpet:failed", "FakeNitro:started"],
          failures: [{ id: "petpet", error: "Cannot read properties of undefined" }],
        },
      },
      ACCEPTANCE,
      OPTIONS,
    );
    const petpet = plugin(report, "petpet");
    expect(petpet.tier1).toBe("fail");
    expect(petpet.reason).toContain("Cannot read properties of undefined");
    expect(petpet.tier2).toBe("fail");
  });

  test("fails a plugin with an error-level patch notice", () => {
    const report = analyze(
      {
        ...OK,
        patchStats: {
          FakeNitro: {
            registered: 2,
            applied: 0,
            active: 2,
            notices: [{ level: "error", message: "no match for replacement in module 123" }],
          },
        },
      },
      ACCEPTANCE,
      OPTIONS,
    );
    const fakeNitro = plugin(report, "FakeNitro");
    expect(fakeNitro.tier1).toBe("fail");
    expect(fakeNitro.reason).toMatch(/patch failed/);
  });

  test("attributes warnings to their plugin and keeps the rest visible", () => {
    const report = analyze(
      {
        ...OK,
        warnings: [
          "[CommandsAPI] Not registering petpet",
          "[ion] [webpack] findModuleId found no factory",
        ],
      },
      ACCEPTANCE,
      OPTIONS,
    );
    expect(plugin(report, "CommandsAPI").status).toBe("warnings");
    expect(plugin(report, "CommandsAPI").warnings).toHaveLength(1);
    expect(report.run.unattributedWarnings).toHaveLength(1);
    expect(report.summary.warnings).toBe(1);
  });

  test("honours a documented deferral even when the run is clean", () => {
    const acceptance: readonly AcceptanceEntry[] = [
      {
        group: "C",
        folder: "webScreenShareFixes.web",
        name: "CommandsAPI",
        note: "deferred: blocked on screenshare audio",
      },
    ];
    const report = analyze(OK, acceptance, OPTIONS);
    const deferred = plugin(report, "CommandsAPI");
    expect(deferred.tier1).toBe("pass");
    expect(deferred.status).toBe("deferred");
    expect(deferred.reason).toMatch(/screenshare/);
  });

  test("an attributable uncaught error fails Tier 2 even in a short run", () => {
    const report = analyze(
      { ...OK, settleMs: 10_000, rendererErrors: ["[FakeNitro] boom"] },
      ACCEPTANCE,
      OPTIONS,
    );
    const fakeNitro = plugin(report, "FakeNitro");
    expect(fakeNitro.tier2).toBe("fail");
    expect(fakeNitro.status).toBe("fail");
    // Placed on a plugin, so it is that plugin's result rather than a defect
    // in the measurement: it fails the row (and the exit code with it), and
    // the run itself still knows what every error it saw belonged to.
    expect(report.runHealthy).toBe(true);
    expect(report.run.unattributedRendererErrors).toEqual([]);
  });

  test("takes the host's registered name over the catalog's when they differ", () => {
    // Two plugins may publish under one name, or collide with another
    // adapter's, and the adapter suffixes to satisfy the host. Its answer is
    // what the plugin's console label carries — taking it here means the
    // collision rule lives in one place, next to the code that applies it.
    const report = analyze(
      {
        ...OK,
        pluginsStatus: {
          status: { registered: 1, started: 1, failed: 0 },
          ids: ["shelter.collide:started"],
          failures: [],
          names: { "shelter.collide": "Shared (collide)" },
        },
        warnings: ["[Shared (collide)] did a thing"],
      },
      [{ group: "bulk", name: "Shared", id: "shelter.collide", url: "https://example.com/c/" }],
      { ...OPTIONS, ecosystem: "shelter", upstream: "live index" },
    );

    const row = plugin(report, "Shared (collide)");
    expect(row.warnings).toHaveLength(1);
    expect(report.run.unattributedWarnings).toEqual([]);
  });

  test("attributes an error by the file it came from, not only by a label", () => {
    // A Content Security Policy refusal carries no plugin label — all the
    // evidence it has is the script that provoked it, which for a Shelter
    // plugin is the `sourceURL` it was evaluated under.
    const swept: readonly AcceptanceEntry[] = [
      { group: "bulk", name: "Gone", id: "shelter.gone", url: "https://example.com/gone/" },
      { group: "bulk", name: "Mine", id: "shelter.mine", url: "https://example.com/mine/" },
      { group: "bulk", name: "Mine 2", id: "shelter.mine-2", url: "https://example.com/mine-2/" },
    ];
    const report = analyze(
      {
        ...OK,
        pluginsStatus: {
          status: { registered: 3, started: 3, failed: 0 },
          ids: ["shelter.gone:started", "shelter.mine:started", "shelter.mine-2:started"],
          failures: [],
        },
        rendererErrors: [
          "Refused to connect … connect-src [source: s://!SHELTER/mine]",
          // A folder that extends another folder's name: the marker has to
          // be matched whole, or this belongs to `mine` as well.
          "boom [source: s://!SHELTER/mine-2]",
        ],
      },
      swept,
      { ...OPTIONS, ecosystem: "shelter", upstream: "live index" },
    );

    expect(plugin(report, "Gone").status).toBe("pass");
    expect(plugin(report, "Mine").reason).toContain("connect-src");
    expect(plugin(report, "Mine 2").reason).toContain("boom");
    expect(report.run.unattributedRendererErrors).toEqual([]);
    expect(report.runHealthy).toBe(true);
  });

  test("unattributed renderer errors fail the run, not a random plugin", () => {
    const report = analyze({ ...OK, rendererErrors: ["TypeError: ???"] }, ACCEPTANCE, OPTIONS);
    expect(report.summary.fail).toBe(0);
    expect(report.runHealthy).toBe(false);
    expect(report.run.unattributedRendererErrors).toEqual(["TypeError: ???"]);
  });

  test("reports by-design expected errors as evidence, not failures", () => {
    const report = analyze(
      { ...OK, expectedErrors: { "NoTrack deliberately aborts Sentry's module evaluation": 1 } },
      ACCEPTANCE,
      OPTIONS,
    );
    expect(report.runHealthy).toBe(true);
    expect(report.run.expectedErrors).toEqual([
      { reason: "NoTrack deliberately aborts Sentry's module evaluation", count: 1 },
    ]);
  });

  test("matches BetterDiscord entries by their bd.<name> host id", () => {
    const bdAcceptance: readonly AcceptanceEntry[] = [
      { group: "A", name: "BlurNSFW", id: "bd.BlurNSFW" },
    ];
    const report = analyze(
      {
        ...OK,
        pluginsStatus: {
          status: { registered: 1, started: 1, failed: 0 },
          ids: ["bd.BlurNSFW:started"],
          failures: [],
        },
      },
      bdAcceptance,
      { ...OPTIONS, ecosystem: "bd", upstream: "133bc83 (Apache-2.0 port of BdApi)" },
    );
    expect(report.meta.ecosystem).toBe("bd");
    expect(plugin(report, "BlurNSFW").tier1).toBe("pass");
    expect(plugin(report, "BlurNSFW").tier2).toBe("pass");
  });

  test("attributes console-style-format messages after stripping %c", () => {
    const bdAcceptance: readonly AcceptanceEntry[] = [
      { group: "A", name: "BlurNSFW", id: "bd.BlurNSFW" },
    ];
    const report = analyze(
      {
        ...OK,
        pluginsStatus: {
          status: { registered: 1, started: 1, failed: 0 },
          ids: ["bd.BlurNSFW:started"],
          failures: [],
        },
        warnings: ["%c[BlurNSFW]%c something cosmetic"],
        rendererErrors: ["%c[BlurNSFW]%c observer() threw in BlurNSFW v1.0.5"],
      },
      bdAcceptance,
      { ...OPTIONS, ecosystem: "bd" },
    );
    const blur = plugin(report, "BlurNSFW");
    expect(blur.warnings).toHaveLength(1);
    expect(blur.tier2).toBe("fail");
    expect(blur.reason).toContain("observer() threw");
    expect(report.run.unattributedWarnings).toEqual([]);
    expect(report.run.unattributedRendererErrors).toEqual([]);
  });

  test("defers an entry the runner never staged, instead of blaming the adapter", () => {
    const sweep: readonly AcceptanceEntry[] = [
      {
        group: "bulk",
        name: "Gone",
        id: "shelter.gone",
        url: "https://example.com/gone/",
        unstaged: "not staged: plugin.js HTTP 404",
      },
      { group: "bulk", name: "Here", id: "shelter.here", url: "https://example.com/here/" },
    ];
    const report = analyze(
      {
        ...OK,
        pluginsStatus: {
          status: { registered: 1, started: 1, failed: 0 },
          ids: ["shelter.here:started"],
          failures: [],
        },
      },
      sweep,
      { ...OPTIONS, ecosystem: "shelter", upstream: "live index https://shindex.uwu.network/data" },
    );

    // Not staged means nothing was measured — "did not register" would put
    // the failure on the adapter for a file that never arrived.
    const gone = plugin(report, "Gone");
    expect(gone.tier1).toBe("not-run");
    expect(gone.status).toBe("deferred");
    expect(gone.reason).toContain("HTTP 404");
    expect(plugin(report, "Here").status).toBe("pass");
    expect(report.summary).toMatchObject({ total: 2, pass: 1, fail: 0, deferred: 1 });
  });
});
