/**
 * Structural mirrors of the upstream Vencord types the adapter consumes.
 *
 * The vendored upstream sources are compiled by esbuild (no typecheck), so
 * these interfaces exist purely for `src/` — the adapter's own typechecked
 * code — to consume plugin definitions and settings objects with real types
 * without pulling upstream's type graph (and its `any`-heavy React surface)
 * into our strict tsc run. They intentionally mirror only the fields the
 * adapter reads; upstream remains the source of truth (see THIRD_PARTY.md).
 */

export type VencordStartAt = "Init" | "DOMContentLoaded" | "WebpackReady";

export interface VencordPatchReplacement {
  readonly match: string | RegExp;
  readonly replace: string | ((...args: string[]) => string);
  /** Return false to drop this replacement at registration. */
  readonly predicate?: () => boolean;
}

export interface VencordPatch {
  readonly find: string | RegExp;
  /** A single replacement or a list; upstream accepts both shapes. */
  readonly replacement: VencordPatchReplacement | readonly VencordPatchReplacement[];
  /** Apply to every matching module instead of the first. */
  readonly all?: boolean;
  /** All-or-nothing: no replacement applies unless every match succeeds. */
  readonly group?: boolean;
  readonly predicate?: () => boolean;
  readonly fromBuild?: number;
  readonly toBuild?: number;
}

/** One option of `definePluginSettings`, as the adapter's UI consumes it. */
export interface VencordPluginSettingDef {
  readonly type?: string;
  readonly default?: unknown;
  readonly onChange?: () => void;
}

/** The object `definePluginSettings` returns. */
export interface VencordPluginSettings {
  /** Set by the adapter before start, exactly as upstream's manager does. */
  pluginName: string;
  readonly def: Record<string, VencordPluginSettingDef>;
  readonly store: Record<string, unknown>;
}

/** A Flux dispatcher subset — enough for subscribe/unsubscribe wiring. */
export interface VencordFluxDispatcher {
  subscribe(event: string, handler: (event: unknown) => void): void;
  unsubscribe(event: string, handler: (event: unknown) => void): void;
}

/** The per-plugin slice of Vencord's `Settings.plugins` store. */
export interface VencordPluginSettingsEntry {
  enabled: boolean;
  [key: string]: unknown;
}

/** Vencord's runtime settings store (an instance of their SettingsStore). */
export interface VencordSettingsStore {
  readonly plugins: Record<string, VencordPluginSettingsEntry>;
  readonly plain: Record<string, unknown>;
}

/**
 * A Vencord plugin definition as produced by `definePlugin`. Feature fields
 * are typed loosely (`unknown`) because the adapter never inspects their
 * internals — it hands them to the vendored plugin manager, which registers
 * them with the vendored APIs.
 */
export interface VencordPlugin {
  readonly name: string;
  readonly description: string;
  readonly authors?: readonly { readonly name: string }[];
  readonly patches?: readonly VencordPatch[];
  readonly dependencies?: readonly string[];
  readonly required?: boolean;
  readonly enabledByDefault?: boolean;
  readonly startAt?: VencordStartAt;
  readonly settings?: VencordPluginSettings;
  readonly flux?: Record<string, (event: unknown) => unknown>;
  readonly contextMenus?: Record<string, unknown>;
  readonly commands?: readonly unknown[];
  readonly toolboxActions?: unknown;
  readonly managedStyle?: string;
  readonly userProfileBadge?: unknown;
  readonly messagePopoverButton?: unknown;
  readonly chatBarButton?: unknown;
  readonly onMessageClick?: unknown;
  readonly onBeforeMessageSend?: unknown;
  readonly onBeforeMessageEdit?: unknown;
  readonly renderMessageAccessory?: unknown;
  readonly renderMessageDecoration?: unknown;
  readonly renderMemberListDecorator?: unknown;
  readonly start?: () => void;
  readonly stop?: () => void;
  /** Maintained by the vendored plugin manager; do not set from outside. */
  started?: boolean;
  readonly isDependency?: boolean;
}
