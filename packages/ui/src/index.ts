import type { IonGlobal, ShellHost } from "@ion/core";
import { startSettingsIntegration } from "./integration";
import { mountPanel } from "./panel";

/**
 * Bolt glyph for the sidebar row; matches Ion's debug-dock icon language.
 * First-party markup — never user- or plugin-supplied.
 */
const BOLT_ICON_SVG = `
<svg class="icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="currentColor" d="M13.2 2 4 14h6.2l-1.4 8L18 10h-6.2l1.4-8Z"/>
</svg>`;

function start(): void {
  const ion: IonGlobal | undefined = window.__ION__;
  const shell: ShellHost | undefined = window.ionShell;
  if (!ion?.plugins || !shell) return;
  const plugins = ion.plugins;

  startSettingsIntegration({
    doc: document,
    id: "ion_panel",
    label: "Ion",
    iconSvg: BOLT_ICON_SVG,
    renderPanel: (host) =>
      mountPanel(host, {
        plugins,
        shellSettings: shell.settings,
        version: ion.version,
        shellVersion: shell.appVersion,
        webpackStatus: () => ion.webpack,
        openExternal: (url) => shell.openExternal(url),
      }),
  });
  // Only claim readiness once the integration actually started.
  ion.ui = { ready: true };
}

start();
