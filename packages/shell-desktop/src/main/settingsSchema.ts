/**
 * Shell settings schema, validation, and persistence-free sanitization.
 *
 * The Electron-dependent parts of the settings store (reading and writing the
 * JSON file) live in `store.ts`; everything here is pure and unit-tested.
 */

export type OzonePlatform = "auto" | "x11" | "wayland";
export type GpuMode = "auto" | "disabled";
export type WebRtcIpPolicy =
  | "default"
  | "default_public_and_private_interfaces"
  | "default_public_interface_only"
  | "disable_non_proxied_udp";

export interface ShellSettings {
  /** Close the window to the tray instead of quitting. */
  readonly closeToTray: boolean;
  /** Show a tray icon. */
  readonly trayEnabled: boolean;
  readonly hardwareAcceleration: boolean;
  readonly ozonePlatform: OzonePlatform;
  readonly gpuMode: GpuMode;
  readonly webRTCIPHandlingPolicy: WebRtcIpPolicy;
  /** Extra Chromium switches, e.g. ["enable-features=Foo", "disable-gpu-driver-bug-workarounds"]. */
  readonly extraChromiumFlags: readonly string[];
}

export const DEFAULT_SHELL_SETTINGS: ShellSettings = {
  closeToTray: true,
  trayEnabled: true,
  hardwareAcceleration: true,
  ozonePlatform: "auto",
  gpuMode: "auto",
  webRTCIPHandlingPolicy: "default",
  extraChromiumFlags: [],
};

const OZONE_PLATFORMS: readonly OzonePlatform[] = ["auto", "x11", "wayland"];
const GPU_MODES: readonly GpuMode[] = ["auto", "disabled"];
const WEBRTC_POLICIES: readonly WebRtcIpPolicy[] = [
  "default",
  "default_public_and_private_interfaces",
  "default_public_interface_only",
  "disable_non_proxied_udp",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickStringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Coerce arbitrary persisted JSON into a valid settings object.
 * Unknown keys are dropped; invalid values fall back to defaults.
 */
export function sanitizeShellSettings(raw: unknown): ShellSettings {
  const source = isRecord(raw) ? raw : {};
  const defaults = DEFAULT_SHELL_SETTINGS;
  return {
    closeToTray: pickBoolean(source["closeToTray"], defaults.closeToTray),
    trayEnabled: pickBoolean(source["trayEnabled"], defaults.trayEnabled),
    hardwareAcceleration: pickBoolean(
      source["hardwareAcceleration"],
      defaults.hardwareAcceleration,
    ),
    ozonePlatform: pickEnum(source["ozonePlatform"], OZONE_PLATFORMS, defaults.ozonePlatform),
    gpuMode: pickEnum(source["gpuMode"], GPU_MODES, defaults.gpuMode),
    webRTCIPHandlingPolicy: pickEnum(
      source["webRTCIPHandlingPolicy"],
      WEBRTC_POLICIES,
      defaults.webRTCIPHandlingPolicy,
    ),
    extraChromiumFlags: pickStringArray(source["extraChromiumFlags"], defaults.extraChromiumFlags),
  };
}

const SHELL_SETTING_KEYS = Object.keys(DEFAULT_SHELL_SETTINGS) as (keyof ShellSettings)[];

export function isShellSettingKey(key: string): key is keyof ShellSettings {
  return (SHELL_SETTING_KEYS as readonly string[]).includes(key);
}

/**
 * Validate a `{key, value}` update from the renderer.
 *
 * Returns the full settings object with the patch applied, or null when the
 * key is unknown or the value would not survive sanitization (wrong type,
 * bad enum member, non-string array entries).
 */
export function applyShellSettingsPatch(
  current: ShellSettings,
  key: string,
  value: unknown,
): ShellSettings | null {
  if (!isShellSettingKey(key)) return null;
  const candidate = sanitizeShellSettings({ ...current, [key]: value });
  const survived = candidate[key];
  const accepted =
    typeof value === "object" && value !== null
      ? JSON.stringify(survived) === JSON.stringify(value)
      : survived === value;
  return accepted ? candidate : null;
}
