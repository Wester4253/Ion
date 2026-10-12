/**
 * `BdApi.Logger` — BetterDiscord's logging surface.
 *
 * Behavioral port of BetterDiscord's `src/betterdiscord/api/logger.ts`
 * (Apache-2.0, see THIRD_PARTY.md): messages go to the console as
 * `%c[Name]%c ...`, which Chromium expands to `[Name] ...` in the captured
 * `console-message` — the exact prefix the compat harness attributes
 * warnings/errors to plugins by. That format is a compatibility contract,
 * not a style choice, so this file is compat-bd's sole console chokepoint
 * (mirroring core's logging.ts).
 */

/* eslint-disable no-console -- compat-bd's only console access point; BdApi.Logger's
   output format is a compatibility contract consumed by the compat harness. */

const logTypes = {
  error: "error",
  debug: "debug",
  log: "log",
  warn: "warn",
  info: "info",
} as const;

type LogType = keyof typeof logTypes;

function parseType(type: string): LogType {
  return type in logTypes ? (type as LogType) : "log";
}

const NAME_STYLE = "color: #3a71c1; font-weight: 700;";
const MESSAGE_STYLE = "";

const boundLoggers = new Map<string, BoundLogger>();

/**
 * Resolve (and memoize) the scoped logger a plugin name maps to. Lives here
 * rather than in `api/index.ts` so the patcher can report a failing plugin's
 * callback under that plugin's own name without importing the API surface
 * (which imports the patcher).
 */
export function boundLoggerFor(pluginName: string): BoundLogger {
  let scoped = boundLoggers.get(pluginName);
  if (!scoped) {
    scoped = new BoundLogger(pluginName);
    boundLoggers.set(pluginName, scoped);
  }
  return scoped;
}

function log(pluginName: string, messages: readonly unknown[], type: LogType = "log"): void {
  const level = parseType(type);
  console[level](`%c[${pluginName}]%c`, NAME_STYLE, MESSAGE_STYLE, ...messages);
}

/**
 * The static logger: every call carries the plugin name as its first
 * argument (`Logger.error("MyPlugin", "boom")`).
 */
export class Logger {
  /** Logs an error using a collapsed error group with stacktrace. */
  stacktrace(pluginName: string, message: unknown, error: Error): void {
    console.error(
      `%c[${pluginName}]%c ${String(message)}\n\n%c`,
      NAME_STYLE,
      "color: red; font-weight: 700;",
      "color: red;",
      error,
    );
  }

  error(pluginName: string, ...messages: unknown[]): void {
    log(pluginName, messages, "error");
  }

  warn(pluginName: string, ...messages: unknown[]): void {
    log(pluginName, messages, "warn");
  }

  info(pluginName: string, ...messages: unknown[]): void {
    log(pluginName, messages, "info");
  }

  debug(pluginName: string, ...messages: unknown[]): void {
    log(pluginName, messages, "debug");
  }

  log(pluginName: string, ...messages: unknown[]): void {
    log(pluginName, messages, "log");
  }
}

/**
 * The instance logger returned by `new BdApi(name).Logger`: the plugin name
 * is supplied once at construction.
 */
export class BoundLogger {
  readonly #pluginName: string;

  constructor(pluginName: string) {
    this.#pluginName = pluginName;
  }

  stacktrace(message: unknown, error: Error): void {
    console.error(
      `%c[${this.#pluginName}]%c ${String(message)}\n\n%c`,
      NAME_STYLE,
      "color: red; font-weight: 700;",
      "color: red;",
      error,
    );
  }

  error(...messages: unknown[]): void {
    log(this.#pluginName, messages, "error");
  }

  warn(...messages: unknown[]): void {
    log(this.#pluginName, messages, "warn");
  }

  info(...messages: unknown[]): void {
    log(this.#pluginName, messages, "info");
  }

  debug(...messages: unknown[]): void {
    log(this.#pluginName, messages, "debug");
  }

  log(...messages: unknown[]): void {
    log(this.#pluginName, messages, "log");
  }
}

Object.freeze(Logger);
Object.freeze(Logger.prototype);
Object.freeze(BoundLogger);
Object.freeze(BoundLogger.prototype);
