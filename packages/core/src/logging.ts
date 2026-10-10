/**
 * Ion's logging chokepoint.
 *
 * ESLint forbids `console` everywhere in core except here, so every line Ion
 * prints is uniformly prefixed and a future ring-buffer (for the debug panel)
 * only needs one integration point. Output goes to the page's devtools
 * console — Ion performs no telemetry.
 */

/* eslint-disable no-console -- the sole console access point in core */

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  const prefix = `[ion] [${scope}]`;
  return {
    info(...args: unknown[]): void {
      console.info(prefix, ...args);
    },
    warn(...args: unknown[]): void {
      console.warn(prefix, ...args);
    },
    error(...args: unknown[]): void {
      console.error(prefix, ...args);
    },
  };
}
