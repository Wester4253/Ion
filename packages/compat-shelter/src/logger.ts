/**
 * compat-shelter's console chokepoint and the plugin-scope stack.
 *
 * Two things live here because they are the same concern: which line gets
 * printed, and whose name it carries.
 *
 * Shelter's `util.log` prints `%c<Label>%c` followed by the message, and
 * Chromium's captured `console-message` keeps the format specifiers. The
 * compat harness strips `%c` and attributes a message that starts with
 * `[Name]` to that plugin — so the label is a compatibility contract, not a
 * style choice. Upstream always prints `shelter`; here the label is the
 * display name of the plugin whose code is running, which is what makes a
 * plugin's own warnings and errors land on its row of the scoreboard
 * instead of in the run's unattributed bucket. Messages printed outside any
 * plugin keep the upstream `shelter` label and stay unattributed, and the
 * adapter's own lines use `[compat-shelter]` for the same reason.
 *
 * The scope stack tracks the running plugin across the places shelter code
 * runs without an obvious owner: module evaluation, `onLoad`/`onUnload`, and
 * every callback handed to the scoped API (flux subscriptions, patches, DOM
 * observations). Callbacks that reach the page by other means still print
 * unattributed — visible, never guessed at.
 */

/* eslint-disable no-console -- compat-shelter's sole console access point;
   shelter's log() output format is a compatibility contract consumed by the
   compat harness, exactly like compat-bd's logger. */

/** Label style: shelter's own gradient, unchanged. */
const SHELTER_STYLE =
  "background: linear-gradient(180deg, #2A3B4B 0%, #2BFAAC 343.17%); color: white; padding: 6px; border-radius: 4px;";
const MESSAGE_STYLE = "";

/** The plugin whose code is on the stack right now. */
export interface PluginScope {
  /** Host id (`shelter.<folder>`); used for lifecycle messages. */
  readonly id: string;
  /** Display name from `plugin.json`; used for console attribution. */
  readonly name: string;
}

let activeScope: PluginScope | undefined;

/** The plugin currently on the stack, or undefined outside plugin code. */
export function currentPluginScope(): PluginScope | undefined {
  return activeScope;
}

/**
 * Runs `fn` with `scope` on the stack, restoring the previous scope even
 * when `fn` throws — a plugin's failure must not leave a stale name behind
 * for the next plugin's messages.
 */
export function runInPluginScope<T>(scope: PluginScope, fn: () => T): T {
  const previous = activeScope;
  activeScope = scope;
  try {
    return fn();
  } finally {
    activeScope = previous;
  }
}

/**
 * Wraps a callback so it runs under `scope`. Used for every function a
 * plugin hands to the scoped API, so a subscription that logs an error is
 * reported against the plugin that registered it.
 */
export function wrapInPluginScope<A extends unknown[], R>(
  scope: PluginScope,
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A) => runInPluginScope(scope, () => fn(...args));
}

/** Console levels this adapter may print at. */
type Level = "info" | "log" | "warn" | "error";

/** Prints one attributed line: `%c[Label]%c` + payload. */
function print(label: string, level: Level, messages: readonly unknown[]): void {
  console[level](`%c[${label}]%c`, SHELTER_STYLE, MESSAGE_STYLE, ...messages);
}

/**
 * The adapter's own logger scope: lines about loading, not about one
 * plugin. The harness keeps them visible as unattributed run notes —
 * never dropped, never blamed on the wrong plugin.
 */
export function adapterLog(level: Level, ...messages: readonly unknown[]): void {
  print("compat-shelter", level, messages);
}

/** Formats any thrown value for the one-line messages this adapter logs. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `util.log`'s levels: upstream only exposes these three plus its default. */
export type ShelterLogLevel = "log" | "warn" | "error";

/**
 * Shelter's `util.log`, byte-for-byte in shape: an array argument is spread
 * as separate console arguments, a bare value is printed as one.
 *
 * The only difference from upstream is the label, described at the top of
 * this file and recorded as a deviation in THIRD_PARTY.md.
 */
export function shelterLog(text: unknown, level: ShelterLogLevel = "log"): void {
  const messages: readonly unknown[] = Array.isArray(text) ? text : [text];
  print(currentPluginScope()?.name ?? "shelter", level, messages);
}
