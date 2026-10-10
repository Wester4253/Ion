import { describe, expect, test } from "vitest";

import { buildChromiumSwitchPlan, parseRawFlag } from "./flags";
import {
  applyShellSettingsPatch,
  DEFAULT_SHELL_SETTINGS,
  sanitizeShellSettings,
} from "./settingsSchema";
import type { ShellSettings } from "./settingsSchema";

function overrides(patch: Partial<ShellSettings>): ShellSettings {
  return { ...DEFAULT_SHELL_SETTINGS, ...patch };
}

function switchValue(
  plan: ReturnType<typeof buildChromiumSwitchPlan>,
  name: string,
): string | undefined {
  let found: string | undefined;
  for (const [switchName, value] of plan.switches) {
    if (switchName === name) found = value;
  }
  return found;
}

describe("parseRawFlag", () => {
  test("parses flags with and without values", () => {
    expect(parseRawFlag("--enable-features=Foo,Bar")).toEqual(["enable-features", "Foo,Bar"]);
    expect(parseRawFlag("disable-gpu")).toEqual(["disable-gpu", undefined]);
    expect(parseRawFlag("--no-sandbox")).toEqual(["no-sandbox", undefined]);
    expect(parseRawFlag("  ")).toBeNull();
  });
});

describe("buildChromiumSwitchPlan", () => {
  test("applies defaults", () => {
    const plan = buildChromiumSwitchPlan(DEFAULT_SHELL_SETTINGS, "linux", []);
    expect(switchValue(plan, "ozone-platform-hint")).toBe("auto");
    expect(switchValue(plan, "autoplay-policy")).toBe("no-user-gesture-required");
    expect(plan.disableHardwareAcceleration).toBe(false);
  });

  test("disables hardware acceleration from settings or argv", () => {
    expect(
      buildChromiumSwitchPlan(overrides({ hardwareAcceleration: false }), "linux", [])
        .disableHardwareAcceleration,
    ).toBe(true);
    expect(
      buildChromiumSwitchPlan(overrides({ gpuMode: "disabled" }), "linux", [])
        .disableHardwareAcceleration,
    ).toBe(true);
    expect(
      buildChromiumSwitchPlan(DEFAULT_SHELL_SETTINGS, "linux", ["--disable-gpu"])
        .disableHardwareAcceleration,
    ).toBe(true);
    expect(
      buildChromiumSwitchPlan(DEFAULT_SHELL_SETTINGS, "win32", []).disableHardwareAcceleration,
    ).toBe(false);
  });

  test("disables washed-out-color feature only on linux", () => {
    const linux = switchValue(
      buildChromiumSwitchPlan(DEFAULT_SHELL_SETTINGS, "linux", []),
      "disable-features",
    );
    const windows = switchValue(
      buildChromiumSwitchPlan(DEFAULT_SHELL_SETTINGS, "win32", []),
      "disable-features",
    );
    expect(linux).toContain("WaylandWpColorManagerV1");
    expect(windows).not.toContain("WaylandWpColorManagerV1");
  });

  test("merges user feature lists without dropping ours", () => {
    const plan = buildChromiumSwitchPlan(
      overrides({ extraChromiumFlags: ["enable-features=CustomThing", "disable-features=Nope"] }),
      "linux",
      [],
    );
    const enabled = switchValue(plan, "enable-features");
    expect(enabled).toContain("CustomThing");
    expect(enabled).toContain("AcceleratedVideoDecoder");
    const disabled = switchValue(plan, "disable-features");
    expect(disabled).toContain("Nope");
    expect(disabled).toContain("HardwareMediaKeyHandling");
    // Merged lists must not appear twice as raw switches.
    expect(plan.switches.filter(([name]) => name === "enable-features")).toHaveLength(1);
  });

  test("user switches override by name and empty entries are ignored", () => {
    const plan = buildChromiumSwitchPlan(
      overrides({ extraChromiumFlags: ["ozone-platform-hint=wayland", "   ", "--some-flag=1"] }),
      "linux",
      [],
    );
    expect(switchValue(plan, "ozone-platform-hint")).toBe("wayland");
    expect(switchValue(plan, "some-flag")).toBe("1");
    expect(plan.switches.filter(([name]) => name === "ozone-platform-hint")).toHaveLength(1);
  });
});

describe("sanitizeShellSettings", () => {
  test("returns defaults for garbage input", () => {
    expect(sanitizeShellSettings(null)).toEqual(DEFAULT_SHELL_SETTINGS);
    expect(sanitizeShellSettings("string")).toEqual(DEFAULT_SHELL_SETTINGS);
    expect(sanitizeShellSettings([])).toEqual(DEFAULT_SHELL_SETTINGS);
  });

  test("keeps valid values and drops invalid ones", () => {
    const result = sanitizeShellSettings({
      closeToTray: false,
      ozonePlatform: "wayland",
      gpuMode: "unsupported-mode",
      extraChromiumFlags: ["ok", 42, null],
      unknownKey: "ignored",
    });
    expect(result.closeToTray).toBe(false);
    expect(result.ozonePlatform).toBe("wayland");
    expect(result.gpuMode).toBe("auto");
    expect(result.extraChromiumFlags).toEqual(["ok"]);
    expect("unknownKey" in result).toBe(false);
  });
});

describe("applyShellSettingsPatch", () => {
  test("accepts valid patches", () => {
    const patched = applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "closeToTray", false);
    expect(patched?.closeToTray).toBe(false);

    const patchedList = applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "extraChromiumFlags", [
      "--foo",
    ]);
    expect(patchedList?.extraChromiumFlags).toEqual(["--foo"]);
  });

  test("refuses unknown keys", () => {
    expect(applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "evalEnabled", true)).toBeNull();
    expect(applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "__proto__", {})).toBeNull();
    expect(applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "constructor", {})).toBeNull();
  });

  test("refuses values that fail sanitization", () => {
    expect(applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "closeToTray", "yes")).toBeNull();
    expect(applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "ozonePlatform", "beos")).toBeNull();
    expect(
      applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "extraChromiumFlags", [1, 2]),
    ).toBeNull();
    expect(
      applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "extraChromiumFlags", "not-an-array"),
    ).toBeNull();
  });

  test("leaves other settings untouched", () => {
    const patched = applyShellSettingsPatch(DEFAULT_SHELL_SETTINGS, "trayEnabled", false);
    expect(patched).toEqual({ ...DEFAULT_SHELL_SETTINGS, trayEnabled: false });
  });
});
