/**
 * BetterDiscord's internal logger — the `%c[BetterDiscord]%c [module]%c`
 * console format that BD's own modules (the patcher, WebpackModules, the
 * addon managers) log through. Behavioral port of BetterDiscord's
 * src/common/logger.ts (Apache-2.0, see THIRD_PARTY.md).
 *
 * This is one of compat-bd's console chokepoints (mirroring core's
 * logging.ts). The `[BetterDiscord] [module]` prefix this emits is the
 * format users see in BetterDiscord and the format the compat harness
 * reads back out of Electron's `console-message`.
 *
 * Note this is deliberately separate from `api/logger.ts`: upstream also
 * keeps two loggers — this one for BD-internal messages, and
 * `BdApi.Logger` for plugin-facing ones keyed by plugin name.
 */

/* eslint-disable no-console -- compat-bd's console access point for
   BetterDiscord-internal logging; the output format mirrors upstream. */

type ConsoleLevel = "error" | "debug" | "log" | "warn" | "info";

const NAME_STYLE = "color: #3E82E5; font-weight: 700;";
const MODULE_STYLE = "color: #3a71c1;";

function log(level: ConsoleLevel, module: string, messages: readonly unknown[]): undefined {
  console[level](`%c[BetterDiscord]%c [${module}]%c`, NAME_STYLE, MODULE_STYLE, "", ...messages);
  return undefined;
}

/**
 * Static logger keyed by BD module name. Every method returns `undefined`
 * so call sites can `return Logger.error(...)` the way upstream does.
 */
export const Logger = {
  error: (module: string, ...messages: readonly unknown[]): undefined => {
    log("error", module, messages);
  },

  warn: (module: string, ...messages: readonly unknown[]): undefined => {
    log("warn", module, messages);
  },

  info: (module: string, ...messages: readonly unknown[]): undefined => {
    log("info", module, messages);
  },

  debug: (module: string, ...messages: readonly unknown[]): undefined => {
    log("debug", module, messages);
  },

  log: (module: string, ...messages: readonly unknown[]): undefined => {
    log("log", module, messages);
  },

  /** Collapsed error group with stacktrace, as upstream's `stacktrace`. */
  stacktrace: (module: string, message: unknown, error: Error): undefined => {
    console.error(
      `%c[BetterDiscord]%c [${module}]%c ${String(message)}\n\n%c`,
      NAME_STYLE,
      MODULE_STYLE,
      "color: red; font-weight: 700;",
      "color: red;",
      error,
    );
    return undefined;
  },
};
