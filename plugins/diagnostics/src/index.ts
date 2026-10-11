/**
 * Ion diagnostics plugin.
 *
 * Press the configured shortcut (default Ctrl+Alt+J) to copy a small
 * diagnostics report — versions, webpack discovery state, and plugin
 * lifecycle states — to the clipboard, ready to paste into a bug report.
 * The shortcut is configurable through the plugin's settings namespace.
 */

import type { IonPlugin } from "@ion/core";

const DEFAULT_SHORTCUT = "Ctrl+Alt+J";

interface Shortcut {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  /** Lower-cased `KeyboardEvent.key` value, e.g. "j". */
  readonly key: string;
}

/** Parse "Ctrl+Alt+J" style descriptions; null when malformed. */
function parseShortcut(text: string): Shortcut | null {
  const shortcut = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
  for (const rawPart of text.split("+")) {
    const part = rawPart.trim().toLowerCase();
    if (part.length === 0) return null;
    switch (part) {
      case "ctrl":
      case "control":
        shortcut.ctrl = true;
        break;
      case "alt":
        shortcut.alt = true;
        break;
      case "shift":
        shortcut.shift = true;
        break;
      case "meta":
      case "super":
      case "cmd":
        shortcut.meta = true;
        break;
      default:
        // A second non-modifier key means the description is malformed.
        if (shortcut.key !== "") return null;
        shortcut.key = part;
    }
  }
  return shortcut.key === "" ? null : shortcut;
}

function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  return (
    event.ctrlKey === shortcut.ctrl &&
    event.altKey === shortcut.alt &&
    event.shiftKey === shortcut.shift &&
    event.metaKey === shortcut.meta &&
    event.key.toLowerCase() === shortcut.key
  );
}

function buildReport(): string {
  const ion = window.__ION__;
  const lines = [`Ion ${ion?.version ?? "unknown"}`];
  const webpack = ion?.webpack;
  lines.push(
    webpack == null
      ? "webpack: pending"
      : `webpack: ${String(webpack.factories)} factories, ${String(webpack.cache)} cached, hooked=${String(webpack.hooked)}`,
  );
  lines.push("plugins:");
  for (const plugin of ion?.plugins?.list() ?? []) {
    lines.push(`  ${plugin.name}: ${plugin.state}${plugin.enabled ? "" : " (disabled)"}`);
    if (plugin.error !== undefined) lines.push(`    error: ${plugin.error}`);
  }
  return lines.join("\n");
}

/** The listener lives at module scope so `stop()` can remove the exact one. */
let onKeydown: ((event: KeyboardEvent) => void) | undefined;

const diagnostics: IonPlugin = {
  id: "ion.diagnostics",
  name: "Diagnostics",
  description: `Copy an Ion diagnostics report to the clipboard (default shortcut ${DEFAULT_SHORTCUT}).`,
  authors: [{ name: "Ion" }],
  version: "0.0.0",
  start(context) {
    onKeydown = (event) => {
      const configured: string = context.settings.get("shortcut", DEFAULT_SHORTCUT);
      let shortcut = parseShortcut(configured);
      if (shortcut === null) {
        context.log.warn(
          `invalid shortcut ${JSON.stringify(configured)}; falling back to ${DEFAULT_SHORTCUT}`,
        );
        shortcut = parseShortcut(DEFAULT_SHORTCUT);
      }
      if (shortcut === null || !matches(event, shortcut)) return;
      event.preventDefault();
      void navigator.clipboard.writeText(buildReport()).then(
        () => {
          context.log.info("diagnostics report copied to the clipboard");
        },
        (error: unknown) => {
          context.log.error("failed to copy the diagnostics report", error);
        },
      );
    };
    window.addEventListener("keydown", onKeydown);
  },
  stop() {
    if (onKeydown !== undefined) {
      window.removeEventListener("keydown", onKeydown);
      onKeydown = undefined;
    }
  },
};

export default diagnostics;
