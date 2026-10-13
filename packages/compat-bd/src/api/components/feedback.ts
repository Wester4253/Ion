/**
 * `ErrorBoundary` — upstream's `@ui/errorboundary` (Apache-2.0 — see
 * THIRD_PARTY.md), including the addon-policy render freeze that stops
 * plugins from patching BD's own boundary.
 *
 * One deliberate deviation: upstream's fallback offers "click to open
 * console" through BetterDiscord's IPC; Ion's preload bridge has no
 * devtools channel, so the fallback only renders the message (the error
 * itself is already logged).
 */

import type { Logger } from "../logger";
import type { ComponentsReact } from "./runtime";

export interface ErrorBoundaryProps {
  id?: string;
  name?: string;
  hideError?: boolean;
  fallback?: unknown;
  onError?: (error: Error) => void;
  children?: unknown;
  [key: string]: unknown;
}

/** BD's React error boundary, built against a React instance. */
export function createErrorBoundary(react: ComponentsReact, logger: Logger) {
  class ErrorBoundary extends react.Component<ErrorBoundaryProps & { children?: unknown }> {
    declare props: ErrorBoundaryProps & { children?: unknown };
    override state = { hasError: false };

    componentDidCatch(error: Error): void {
      this.setState({ hasError: true });
      logger.stacktrace(
        "ErrorBoundary",
        `React error detected for {name: ${this.props.name ?? "Unknown"}, id: ${this.props.id ?? "Unknown"}}`,
        error,
      );
      this.props.onError?.(error);
    }

    override render(): unknown {
      if (this.state.hasError && this.props.fallback) {
        return this.props.fallback;
      }
      if (this.state.hasError && !this.props.hideError) {
        return react.createElement(
          "div",
          { className: "react-error" },
          "There was an unexpected Error. See the console for details.",
        );
      }
      return this.props.children;
    }
  }

  // eslint-disable-next-line @typescript-eslint/unbound-method -- the addon-policy port needs the raw prototype method, restored verbatim by the getter.
  const originalRender = ErrorBoundary.prototype.render;
  Object.defineProperty(ErrorBoundary.prototype, "render", {
    enumerable: false,
    configurable: false,
    set() {
      logger.warn(
        "ErrorBoundary",
        "Addon policy for plugins https://docs.betterdiscord.app/plugins/publishing/guidelines#scope",
      );
    },
    get: () => originalRender,
  });

  return ErrorBoundary;
}
