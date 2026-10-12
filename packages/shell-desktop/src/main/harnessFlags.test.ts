import { describe, expect, test } from "vitest";

import { parseSeedVencordSettingsArg, parseSmokeSettleArg } from "./harnessFlags";

describe("parseSeedVencordSettingsArg", () => {
  test("returns the JSON payload after the flag", () => {
    expect(parseSeedVencordSettingsArg(["--ion-smoke", "--ion-seed-vencord-settings={}"])).toBe(
      "{}",
    );
  });

  test("returns null without the flag or an empty value", () => {
    expect(parseSeedVencordSettingsArg(["--ion-profile=/tmp/x"])).toBeNull();
    expect(parseSeedVencordSettingsArg(["--ion-seed-vencord-settings="])).toBeNull();
    expect(parseSeedVencordSettingsArg(["--ion-seed-vencord-settings"])).toBeNull();
  });
});

describe("parseSmokeSettleArg", () => {
  test("returns a positive integer payload", () => {
    expect(parseSmokeSettleArg(["--ion-smoke-settle-ms=180000"])).toBe(180000);
  });

  test("rejects missing, non-numeric, and non-positive values", () => {
    expect(parseSmokeSettleArg([])).toBeNull();
    expect(parseSmokeSettleArg(["--ion-smoke-settle-ms="])).toBeNull();
    expect(parseSmokeSettleArg(["--ion-smoke-settle-ms=abc"])).toBeNull();
    expect(parseSmokeSettleArg(["--ion-smoke-settle-ms=1.5"])).toBeNull();
    expect(parseSmokeSettleArg(["--ion-smoke-settle-ms=0"])).toBeNull();
    expect(parseSmokeSettleArg(["--ion-smoke-settle-ms=-5"])).toBeNull();
  });
});
