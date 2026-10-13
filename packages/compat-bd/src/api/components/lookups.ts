/**
 * Discord-module lookups the ported components need: BetterDiscord's
 * `Tooltip` resolution and the accessibility (reduced-motion) context —
 * the two `DiscordModules` entries the `Components` surface depends on
 * (upstream filters ported 1:1, Apache-2.0 — see THIRD_PARTY.md).
 *
 * Both resolve lazily and memoize on success: the adapter bundle runs
 * before Discord's webpack exists, and the first caller after it does
 * performs the search.
 */

import { discovery } from "../../host";
import type { ComponentsReact } from "./runtime";

/** A Discord context object (opaque to us). */
export type DiscordContext = unknown;

/** Applies a predicate to the module's exports and each exported value. */
function searchExportValues(exports: unknown, predicate: (value: unknown) => boolean): boolean {
  if (predicate(exports)) return true;
  if (typeof exports !== "object" || exports === null) return false;
  return Object.values(exports).some(predicate);
}

/** React context whose current value carries `reducedMotion`. */
function isAccessibilityContext(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const current = (value as Record<string, unknown>)["_currentValue"];
  return typeof current === "object" && current !== null && "reducedMotion" in current;
}

/** Class whose prototype carries `renderTooltip` (Discord's Tooltip HOC). */
function isTooltipComponent(value: unknown): boolean {
  return (
    typeof value === "function" &&
    value.prototype !== undefined &&
    "renderTooltip" in value.prototype
  );
}

let accessibility: DiscordContext;

/**
 * Discord's accessibility context, else the same local fallback upstream
 * uses when the lookup misses.
 */
export function accessibilityContext(react: ComponentsReact): DiscordContext {
  accessibility ??= discovery().find((exports: unknown) =>
    searchExportValues(exports, isAccessibilityContext),
  );
  return accessibility ?? react.createContext({ reducedMotion: { enabled: false } });
}

let tooltip: unknown;

/** Discord's Tooltip component (the `renderTooltip`-prototype HOC). */
export function tooltipComponent(): unknown {
  tooltip ??= discovery().find((exports: unknown) =>
    searchExportValues(exports, isTooltipComponent),
  );
  return tooltip;
}
