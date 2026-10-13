/**
 * compat-shelter's console chokepoint and the plugin-scope stack.
 *
 * Two things live here because they are the same concern: which line gets
 * printed, and whose name it carries.
 *
 * Shelter's `util.log` prints `%c<Label>%c` followed by the message, with
 * the label's gradient handed over as a `%c` argument. Chromium's captured
 * `console-message` cannot apply a style, so it keeps the format specifier
 * *and* inlines the style into the text, leaving every captured line as
 * `%c[Antitrack]%c background: linear-gradient(…) …` — where the label, the
 * only part that carries information, is buried in what is now noise. So the
 * gradient is dropped and the label prints as plain text: `[Name] message`.
 * That is a deliberate deviation from upstream's look, and its reason is
 * evidence rather than taste: the compat harness attributes a captured
 * message that starts with `[Name]` to that plugin, so the label is a
 * compatibility contract, and it has to survive the capture intact. Upstream
 * always prints `shelter`; here the label is the
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
/**
 * One line to the console, label first.
 *
 * Deliberately free of `%c` and its style arguments — see the header for
 * why. Everything else about upstream's shape is kept: the label in square
 * brackets, then the message, spread when it was given as an array.
 */
function print(label: string, level: Level, messages: readonly unknown[]): void {
  console[level](`[${label}]`, ...messages);
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
