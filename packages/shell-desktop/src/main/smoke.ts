/**
 * Development smoke harness: `--ion-smoke=<dir>`.
 *
 * Loads Discord, waits for the page to settle, writes a screenshot and a JSON
 * report, then exits. Used to verify the shell headlessly in CI-like runs; it
 * is never active without the flag.
 */

import { app } from "electron";
import type { BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SETTLE_DELAY_MS = 25_000;

export function parseSmokeArg(argv: readonly string[]): string | null {
  const arg = argv.find((entry) => entry.startsWith("--ion-smoke"));
  if (!arg) return null;
  const value = arg.slice("--ion-smoke".length);
  return value.startsWith("=") && value.length > 1 ? value.slice(1) : ".";
}

export function runSmoke(outputDir: string, win: BrowserWindow): void {
  mkdirSync(outputDir, { recursive: true });

  const timer = setTimeout(() => void finish("timeout"), SETTLE_DELAY_MS);

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  // Renderer errors (including uncaught exceptions) go into the report.
  const rendererErrors: string[] = [];
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") rendererErrors.push(details.message);
  });

  /**
   * Open the user settings modal and select the Ion tab, so the report and
   * the screenshot cover the injected settings UI. Selectors are structural
   * (locale-proof): the gear follows our debug dock, which we control.
   */
  async function tourSettingsUi(probe: (expression: string) => Promise<unknown>): Promise<void> {
    await probe(
      `(() => {
        const gear = document.querySelector("ion-debug-host + button");
        if (gear) { gear.click(); return true; }
        return false;
      })()`,
    );
    await delay(3000);
    await probe(
      `(() => {
        const row = document.querySelector('li[data-settings-sidebar-item="ion_panel"] [role=link]');
        if (row) { row.click(); return true; }
        return false;
      })()`,
    );
    await delay(1500);
  }

  async function finish(reason: string): Promise<void> {
    clearTimeout(timer);
    const contents = win.webContents;
    const probe = async (expression: string): Promise<unknown> =>
      contents.executeJavaScript(expression).catch((error: unknown): unknown => String(error));
    await tourSettingsUi(probe);
    const report: Record<string, unknown> = {
      reason,
      url: contents.getURL(),
      title: contents.getTitle(),
      ionShellPreload: await probe(
        "typeof window.ionShell === 'object' && window.ionShell !== null",
      ),
      coreInjected: await probe(
        "window.__ION__ !== undefined && typeof window.__ION__.version === 'string'",
      ),
      debugPanelMounted: await probe(
        "document.getElementsByTagName('ion-debug-host').length === 1",
      ),
      coreStartMs: await probe("window.__ION__ ? Math.round(window.__ION__.startedAt) : -1"),
      webpackStatus: await probe(
        "window.__ION__ && window.__ION__.webpack ? window.__ION__.webpack : null",
      ),
      debugPanelWebpack: await probe(
        "(() => { const host = document.querySelector('ion-debug-host'); const field = host?.shadowRoot?.querySelector('[data-field=\"webpack\"]'); return field ? field.textContent : null; })()",
      ),
      pluginsStatus: await probe(
        "window.__ION__ && window.__ION__.plugins ? { status: window.__ION__.plugins.status(), ids: window.__ION__.plugins.list().map(p => `${p.id}:${p.state}`) } : null",
      ),
      debugPanelPlugins: await probe(
        "(() => { const host = document.querySelector('ion-debug-host'); const field = host?.shadowRoot?.querySelector('[data-field=\"plugins\"]'); return field ? field.textContent : null; })()",
      ),
      uiReady: await probe("window.__ION__?.ui?.ready === true"),
      debugDockMode: await probe(
        "document.querySelector('ion-debug-host')?.dataset['mode'] ?? null",
      ),
      gearFound: await probe("document.querySelector('ion-debug-host + button') !== null"),
      settingsOpen: await probe(
        "document.querySelector('li[data-settings-sidebar-item]') !== null",
      ),
      settingsStructure: await probe(
        "(() => { const anchor = document.querySelector('li[data-settings-sidebar-item]'); if (!anchor) return null; const ul = anchor.closest('ul'); const content = anchor.closest('aside')?.parentElement; return { hasAside: !!anchor.closest('aside'), hasDialog: !!anchor.closest('[role=dialog]'), sectionsUl: ul?.parentElement?.parentElement?.tagName ?? null, contentBody: !!content?.querySelector('[class*=contentBody]'), scroller: !!content?.querySelector('[class*=contentBody] [class*=scroller]'), crumb: !!content?.querySelector('[class*=contentHeader] li [data-text-variant]') }; })()",
      ),
      ionTabMounted: await probe(
        "document.querySelector('li[data-settings-sidebar-item=\"ion_panel\"]') !== null",
      ),
      ionPanelActive: await probe(
        "(() => { const host = document.querySelector('[class*=contentBody] ion-settings-panel'); return host ? Boolean(host.shadowRoot?.querySelector('.ion-page')) : false; })()",
      ),
      ionPanelRows: await probe(
        "(() => { const host = document.querySelector('[class*=contentBody] ion-settings-panel'); return host?.shadowRoot?.querySelectorAll('.ion-row').length ?? 0; })()",
      ),
    };
    // Watch the panel state settle: reveals flicker between probes and capture.
    const ionPanelTimeline: unknown[] = [];
    for (let i = 0; i < 4; i += 1) {
      ionPanelTimeline.push(
        await probe(
          "(() => { const host = document.querySelector('[class*=contentBody] ion-settings-panel'); const scroller = document.querySelector('[class*=contentBody] [class*=scroller]'); return { tabRow: !!document.querySelector('li[data-settings-sidebar-item=\"ion_panel\"]'), panel: !!host, scrollerHidden: scroller ? scroller.style.display === 'none' : null }; })()",
        ),
      );
      await delay(400);
    }
    report["ionPanelTimeline"] = ionPanelTimeline;
    report["rendererErrors"] = rendererErrors.slice(0, 20);
    const image = await contents.capturePage().catch(() => null);
    if (image && !image.isEmpty()) {
      writeFileSync(join(outputDir, "screenshot.png"), image.toPNG());
    }
    writeFileSync(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    app.exit(0);
  }

  win.webContents.once("did-finish-load", () => {
    // The SPA needs a moment after load before the login UI is painted.
    setTimeout(() => void finish("did-finish-load"), 9000);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    void finish(`render-process-gone: ${details.reason}`);
  });
}
