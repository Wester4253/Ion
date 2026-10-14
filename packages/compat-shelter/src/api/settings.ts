/**
 * `shelter.settings` — the settings-tab API plugins register sections with.
 *
 * `BadgeType` is upstream's enum, unchanged (uwu/shelter, CC0-1.0, see
 * THIRD_PARTY.md) — it is data a plugin stores in its own manifest-like
 * descriptor, so the numbers have to line up. The section descriptors are
 * typed exactly as upstream spells them (`["divider"]`, `["header", text]`,
 * `["section", id, title, component, extras?]`) so that no plugin source has
 * to change to be drawn.
 *
 * Registration now *draws*: `settingsLayout.ts` turns each descriptor into
 * layout nodes in Discord's own user settings, which is upstream's mechanism
 * and the reason the rows behave like native ones. What this file owns is the
 * registry — which sections exist, in what order, and what a re-registration
 * with a known id means — plus the one case where drawing is impossible and
 * has to be said out loud: with no Discord React instance there is nothing to
 * render a section with, so the plugin that registered it is told, under its
 * own log scope, instead of finding out from an empty settings sidebar.
 */

import type { SettingsLayoutHost } from "./settingsLayout";

export type { SettingsLayoutHost };

/** Upstream's badge kinds, with upstream's values. */
export const BadgeType = {
  NEW: 0,
  BETA: 1,
  COUNT: 2,
  WARNING: 3,
  STRONGLY_DISCOURAGED_CUSTOM: 4,
} as const;

/** A descriptor's decoration: one of {@link BadgeType}'s shapes. */
export type SettingsBadge =
  | { readonly type: typeof BadgeType.NEW }
  | { readonly type: typeof BadgeType.BETA }
  | { readonly type: typeof BadgeType.COUNT; readonly count: number }
  | { readonly type: typeof BadgeType.WARNING }
  | {
      readonly type: typeof BadgeType.STRONGLY_DISCOURAGED_CUSTOM;
      readonly customDecoration: unknown;
    };

/** Extras a section may carry: an icon and/or a badge. */
export interface SettingsExtras {
  readonly icon?: unknown;
  readonly badge?: SettingsBadge;
}

/** One entry in a settings sidebar, exactly as upstream spells it. */
export type SettingsSection =
  | readonly ["divider"]
  | readonly ["header", string]
  | readonly ["section", string, string, unknown, SettingsExtras?];

export interface SettingsSurface {
  readonly BadgeType: typeof BadgeType;
  /**
   * Draws the given sections into Discord's user settings and returns an
   * unsubscribe that removes them again.
   */
  registerSection(...sections: SettingsSection[]): () => void;
}

export interface SettingsSurfaceDeps {
  /** Draws the registry into Discord's settings. */
  readonly layout: SettingsLayoutHost;
  /** Reports a failure under the registering plugin's own log scope. */
  readonly notify: (message: string) => void;
}

/** The id a section is deduplicated by; `undefined` for a header or divider. */
function sectionId(section: SettingsSection): string | undefined {
  return section[0] === "section" ? section[1] : undefined;
}

/** Where `section` already sits in `registered`, or -1 when it is new. */
function indexOfSection(registered: readonly SettingsSection[], section: SettingsSection): number {
  const id = sectionId(section);
  if (id === undefined) return registered.indexOf(section);
  return registered.findIndex((existing) => sectionId(existing) === id);
}

/**
 * Builds the `shelter.settings` surface.
 *
 * A registration with an id that is already drawn *replaces* the section in
 * place, upstream's behaviour: re-registering the same id updates the panel
 * rather than stacking a second row for it.
 */
export function createSettingsSurface(deps: SettingsSurfaceDeps): SettingsSurface {
  const registered: SettingsSection[] = [];

  const redraw = (): boolean => deps.layout.draw(registered);

  const couldNotDraw =
    "settings sections are accepted but could not be drawn: this session's module discovery " +
    "resolved no Discord React instance to render them with; see docs/shelter-stage3.md";

  return {
    BadgeType,
    registerSection(...sections: SettingsSection[]): () => void {
      for (const section of sections) {
        const index = indexOfSection(registered, section);
        if (index === -1) registered.push(section);
        else registered[index] = section;
      }
      if (!redraw()) deps.notify(couldNotDraw);

      return () => {
        for (const section of sections) {
          // By id, not by object: a re-registration with a known id replaced
          // the stored descriptor, so the older object is no longer in the
          // list and a reference match would strand the row.
          const index = indexOfSection(registered, section);
          if (index !== -1) registered.splice(index, 1);
        }
        redraw();
      };
    },
  };
}
