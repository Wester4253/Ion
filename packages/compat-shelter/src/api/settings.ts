/**
 * `shelter.settings` — the settings-tab API plugins register sections with.
 *
 * `BadgeType` is upstream's enum, unchanged (uwu/shelter, CC0-1.0, see
 * THIRD_PARTY.md) — it is data a plugin stores in its own manifest-like
 * descriptor, so the numbers have to line up.
 *
 * `registerSection` is where the gap is. Upstream inserts the section into
 * Discord's user settings by patching `Object.prototype.buildLayout` and
 * forcing a re-render of the sidebar tree — a patch against Discord's
 * internal settings layout, which changes between builds. This adapter
 * accepts the section, keeps it, and hands back a working unsubscribe, so a
 * plugin that registers at load keeps running; what it does *not* do is
 * draw it, and every registration says so in the log rather than leaving a
 * plugin to wonder why its panel never appears. Rendering these into Ion's
 * own settings UI is the follow-up, and it is recorded in docs/status.md.
 *
 * The section descriptors themselves are typed exactly as upstream's
 * (`["divider"]`, `["header", text]`, `["section", id, title, component,
 * extras?]`) so that follow-up needs no change to plugin code.
 */

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
   * Accepts a section descriptor and returns its unsubscribe. The section
   * is kept but not yet drawn into Discord's settings; see the file header.
   */
  registerSection(...sections: SettingsSection[]): () => void;
}

/** Builds the `shelter.settings` surface. */
export function createSettingsSurface(notify: (message: string) => void): SettingsSurface {
  const registered = new Set<SettingsSection>();

  return {
    BadgeType,
    registerSection(...sections: SettingsSection[]): () => void {
      for (const section of sections) registered.add(section);
      // Said every time, under the registering plugin's own log scope, so
      // each plugin that expects a panel is told why it has none.
      notify(
        "settings sections are accepted and kept, but not drawn into Discord's settings yet; see docs/status.md",
      );

      return () => {
        for (const section of sections) registered.delete(section);
      };
    },
  };
}
