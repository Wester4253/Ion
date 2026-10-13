/**
 * The settings context that upstream's `useItemProps` binds input
 * components to (`@ui/contexts`, Apache-2.0 — see THIRD_PARTY.md).
 *
 * The context object needs Discord's React, so it is created on first use
 * and memoized for the session — the lazy twin of upstream's load-time
 * `createContext`.
 */

import type { ComponentsReact } from "./runtime";

/** Sentinel upstream uses for "no controlled value". */
export const NONE: unique symbol = Symbol("betterdiscord.none");

export interface SettingsContextValue {
  value: unknown;
  disabled: boolean;
  /** True when no provider wrapped the component (the uncontrolled path). */
  fail?: boolean;
}

let context: unknown;

/** Discord's settings context, created once React exists. */
export function settingsContext(react: ComponentsReact): unknown {
  context ??= react.createContext({
    value: NONE,
    disabled: false,
    fail: true,
  });
  return context;
}
