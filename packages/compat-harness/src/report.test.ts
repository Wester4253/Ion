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

const OPTIONS = { generatedAt: "2026-10-12T00:00:00.000Z", upstream: "1.15.11 (16ec4ea)" };

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
    expect(report.runHealthy).toBe(false);
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
});
