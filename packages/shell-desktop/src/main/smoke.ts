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

  async function finish(reason: string): Promise<void> {
    clearTimeout(timer);
    const contents = win.webContents;
    const probe = async (expression: string): Promise<unknown> =>
      contents.executeJavaScript(expression).catch((error: unknown): unknown => String(error));
    const report = {
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
    };
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
