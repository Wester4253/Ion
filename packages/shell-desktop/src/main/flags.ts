/**
 * Chromium command-line switch planning.
 *
 * Electron only honors these switches before `app.ready`, so they are computed
 * up front from settings and environment. Pure and unit-tested.
 */

import type { ShellSettings } from "./settingsSchema";

export interface ChromiumSwitchPlan {
  /** `[name, value]` pairs to pass to `app.commandLine.appendSwitch`. */
  readonly switches: readonly (readonly [name: string, value: string | undefined])[];
  /** Whether `app.disableHardwareAcceleration()` must be called before ready. */
  readonly disableHardwareAcceleration: boolean;
}

type Platform = NodeJS.Platform;

/** Chromium features Discord relies on that Electron/Chromium disable by default. */
const CHROMIUM_FEATURES_ENABLED: readonly string[] = [
  "AcceleratedVideoDecoder",
  "AcceleratedVideoEncoder",
];

/**
 * Features disabled for correctness, not performance:
 * - HardwareMediaKeyHandling/MediaSessionService: keep Discord from registering
 *   as a global media player and stealing hardware media keys.
 * - WaylandWpColorManagerV1: washed-out colors when moving between HDR and SDR
 *   monitors (electron/electron#49566).
 */
const CHROMIUM_FEATURES_DISABLED_BASE: readonly string[] = [
  "HardwareMediaKeyHandling",
  "MediaSessionService",
];

/** Switches whose values are merged with ours instead of replaced. */
const MERGED_SWITCHES = new Set(["enable-features", "disable-features"]);

function parseFeatureList(value: string | undefined): Set<string> {
  const set = new Set<string>();
  for (const entry of value?.split(",") ?? []) {
    const trimmed = entry.trim();
    if (trimmed) set.add(trimmed);
  }
  return set;
}

/**
 * Normalize a user-provided raw flag (`--foo=bar`, `foo`, `--flag`) into a
 * switch pair. Returns null for an empty entry.
 */
export function parseRawFlag(
  raw: string,
): readonly [name: string, value: string | undefined] | null {
  const trimmed = raw.trim().replace(/^--/, "");
  if (!trimmed) return null;
  const eq = trimmed.indexOf("=");
  if (eq === -1) return [trimmed, undefined];
  return [trimmed.slice(0, eq), trimmed.slice(eq + 1)];
}

function userValue(
  switches: readonly (readonly [string, string | undefined])[],
  name: string,
): string | undefined {
  // Later entries win, matching appendSwitch semantics.
  let found: string | undefined;
  for (const [switchName, value] of switches) {
    if (switchName === name) found = value;
  }
  return found;
}

/**
 * Build the switch plan for this launch.
 *
 * User-provided switches in `extraChromiumFlags` override ours by name, except
 * `enable-features`/`disable-features`, which are merged so both sets survive.
 *
 * @param settings persisted shell settings
 * @param platform current platform (`process.platform`)
 * @param processArgv raw `process.argv`, used for the `--disable-gpu` escape hatch
 */
export function buildChromiumSwitchPlan(
  settings: ShellSettings,
  platform: Platform,
  processArgv: readonly string[],
): ChromiumSwitchPlan {
  const userSwitches: (readonly [string, string | undefined])[] = [];
  for (const raw of settings.extraChromiumFlags) {
    const parsed = parseRawFlag(raw);
    if (parsed) userSwitches.push(parsed);
  }

  const enableFeatures = parseFeatureList(userValue(userSwitches, "enable-features"));
  for (const feature of CHROMIUM_FEATURES_ENABLED) enableFeatures.add(feature);

  const disableFeatures = parseFeatureList(userValue(userSwitches, "disable-features"));
  for (const feature of CHROMIUM_FEATURES_DISABLED_BASE) disableFeatures.add(feature);
  if (platform === "linux") disableFeatures.add("WaylandWpColorManagerV1");

  const switches: (readonly [string, string | undefined])[] = [
    // Discord relies on media playback that Chromium gates behind a user gesture.
    ["autoplay-policy", "no-user-gesture-required"],
    ["enable-features", [...enableFeatures].sort().join(",")],
    ["disable-features", [...disableFeatures].sort().join(",")],
  ];

  for (const [name, value] of userSwitches) {
    if (MERGED_SWITCHES.has(name)) continue;
    // Overrides: later appendSwitch wins.
    switches.push([name, value]);
  }
  if (!userSwitches.some(([name]) => name === "ozone-platform-hint")) {
    switches.push(["ozone-platform-hint", settings.ozonePlatform]);
  }

  const gpuForceDisabled = processArgv.includes("--disable-gpu") || settings.gpuMode === "disabled";
  const disableHardwareAcceleration = gpuForceDisabled || !settings.hardwareAcceleration;

  return { switches, disableHardwareAcceleration };
}
