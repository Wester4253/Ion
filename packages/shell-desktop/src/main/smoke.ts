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

/** Delay after the first did-finish-load before the report is collected. */
const DEFAULT_SETTLE_MS = 9_000;
/** Extra time above the settle delay for the fallback finish timer. */
const FALLBACK_MARGIN_MS = 16_000;

/** Console warnings kept in the report (deduplicated; further ones dropped). */
const DEFAULT_MAX_WARNINGS = 100;

function maxWarnings(): number {
  const asked = Number(process.env["ION_SMOKE_MAX_WARNINGS"]);
  return Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_MAX_WARNINGS;
}

/**
 * A backstop against a runaway log, not a data-loss point. A hundred is
 * right for a ten-plugin acceptance set and wrong for a sweep of a hundred
 * and thirty: a cap reached in the middle converts every plugin logged after
 * it from "pass with warnings" to a clean pass. The runner raises it to
 * match what it staged.
 */
const MAX_WARNINGS = maxWarnings();

/**
 * Console errors that occur by design in a healthy run, each with the
 * reason it is expected. Everything else lands in `rendererErrors` and
 * fails the run — this list must stay tiny and reviewable.
 */
const EXPECTED_ERRORS: readonly { readonly match: RegExp; readonly reason: string }[] = [
  {
    // The vendored NoTrack plugin disables Sentry by throwing inside its
    // WebpackInstance evaluation (vendor/vencord/src/plugins/_core/
    // noTrack.ts); upstream installs print the same error on every load.
    match: /Sentry successfully disabled/,
    reason: "NoTrack deliberately aborts Sentry's module evaluation",
  },
];

export function parseSmokeArg(argv: readonly string[]): string | null {
  const arg = argv.find((entry) => entry.startsWith("--ion-smoke"));
  if (!arg) return null;
  const value = arg.slice("--ion-smoke".length);
  return value.startsWith("=") && value.length > 1 ? value.slice(1) : ".";
}

export function runSmoke(
  outputDir: string,
  win: BrowserWindow,
  options: { readonly settleMs?: number | undefined } = {},
): void {
  mkdirSync(outputDir, { recursive: true });

  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const timer = setTimeout(() => void finish("timeout"), settleMs + FALLBACK_MARGIN_MS);

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  // Renderer errors (including uncaught exceptions) go into the report.
  // Console errors that are by design of the bundled software are counted
  // separately — this list stays tiny and every entry carries its reason.
  const rendererErrors: string[] = [];
  const expectedErrors = new Map<string, number>();
  const warnings = new Set<string>();
  win.webContents.on("console-message", (details) => {
    if (details.level === "warning") {
      if (warnings.size < MAX_WARNINGS) warnings.add(details.message);
      return;
    }
    if (details.level !== "error") return;
    const expected = EXPECTED_ERRORS.find((entry) => entry.match.test(details.message));
    if (expected) {
      expectedErrors.set(expected.reason, (expectedErrors.get(expected.reason) ?? 0) + 1);
      return;
    }
    rendererErrors.push(details.message);
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

    // Isolated profiles start at the login screen. The settings-modal tour
    // only exists inside a logged-in app, so record the session state and
    // gate the tour on it — the harness requires the settings probes only
    // when a session was present.
    const atLogin = (await probe("location.pathname.startsWith('/login')")) === true;
    if (!atLogin) await tourSettingsUi(probe);
    const report: Record<string, unknown> = {
      reason,
      // "logged-out" for a fresh isolated profile (no session): the
      // settings-modal probes below are then expected to be false/empty
      // and the harness skips them instead of failing the run.
      session: atLogin ? "logged-out" : "in-app",
      url: contents.getURL(),
      title: contents.getTitle(),
      ionShellPreload: await probe(
        "typeof window.ionShell === 'object' && window.ionShell !== null",
      ),
      coreInjected: await probe(
        "window.__ION__ !== undefined && typeof window.__ION__.version === 'string'",
      ),
      discoveryReady: await probe(
        "(() => { const d = window.__ION__?.discovery; return Boolean(d && typeof d.find === 'function' && typeof d.findByProps === 'function' && d.filters && d.onceReady instanceof Promise); })()",
      ),
      debugPanelMounted: await probe(
        "document.getElementsByTagName('ion-debug-host').length === 1",
      ),
      coreStartMs: await probe("window.__ION__ ? Math.round(window.__ION__.startedAt) : -1"),
      // Discord deletes window.localStorage from the window after its own
      // scripts run, so this records both what core captured at injection and
      // whether the page still exposes the property — the pair that separates
      // "storage is broken" from "the page took it away", which otherwise
      // looks identical from the plugin's side.
      domStorage: await probe(
        "window.__ION__ ? { backend: window.__ION__.storage.backend, pageExposesLocalStorage: typeof window.localStorage } : null",
      ),
      webpackStatus: await probe(
        "window.__ION__ && window.__ION__.webpack ? window.__ION__.webpack : null",
      ),
      debugPanelWebpack: await probe(
        "(() => { const host = document.querySelector('ion-debug-host'); const field = host?.shadowRoot?.querySelector('[data-field=\"webpack\"]'); return field ? field.textContent : null; })()",
      ),
      pluginsStatus: await probe(
        "window.__ION__ && window.__ION__.plugins ? { status: window.__ION__.plugins.status(), ids: window.__ION__.plugins.list().map(p => `${p.id}:${p.state}`), failures: window.__ION__.plugins.list().filter(p => p.error).map(p => ({ id: p.id, error: p.error })) } : null",
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
      ionPanelInScroller: await probe(
        "(() => { const host = document.querySelector('ion-settings-panel'); const scroller = host?.closest('[class*=scroller]'); return { inScroller: Boolean(scroller), scrollerVisible: scroller ? scroller.style.display !== 'none' : null, nativeContentHidden: scroller ? [...scroller.children].every((c) => c === host || c.style.display === 'none') : null }; })()",
      ),
    };
    // Watch the panel state settle: reveals flicker between probes and capture.
    const ionPanelTimeline: unknown[] = [];
    for (let i = 0; i < 4; i += 1) {
      ionPanelTimeline.push(
        await probe(
          "(() => { const host = document.querySelector('ion-settings-panel'); const scroller = document.querySelector('[class*=contentBody] [class*=scroller]'); return { tabRow: !!document.querySelector('li[data-settings-sidebar-item=\"ion_panel\"]'), panel: !!host, scrollerVisible: scroller ? scroller.style.display !== 'none' : null, nativeContentHidden: scroller && host ? [...scroller.children].every((c) => c === host || c.style.display === 'none') : null }; })()",
        ),
      );
      await delay(400);
    }
    report["ionPanelTimeline"] = ionPanelTimeline;
    report["rendererErrors"] = rendererErrors.slice(0, 20);
    report["expectedErrors"] = Object.fromEntries(expectedErrors);
    report["warnings"] = [...warnings];
    report["patchStats"] = await probe("window.__ION__?.patches?.stats?.() ?? null");
    const image = await contents.capturePage().catch(() => null);
    if (image && !image.isEmpty()) {
      writeFileSync(join(outputDir, "screenshot.png"), image.toPNG());
    }
    // Bring a panel select into view, open it, and verify the menu escapes
    // the scroller's clipping and stays anchored to its trigger. (Scroll and
    // click are separate steps so the scroll event cannot dismiss the menu
    // we open immediately afterwards.)
    report["ionSelectInView"] = await probe(
      "(() => { const host = document.querySelector('[class*=contentBody] ion-settings-panel'); const trigger = host?.shadowRoot?.querySelector('[aria-label=\"Display server\"]'); if (!trigger) return false; trigger.scrollIntoView({ block: 'center' }); return true; })()",
    );
    await delay(400);
    report["ionSelectOpen"] = await probe(
      "(() => { const host = document.querySelector('[class*=contentBody] ion-settings-panel'); const trigger = host?.shadowRoot?.querySelector('[aria-label=\"Display server\"]'); if (!trigger) return false; trigger.click(); return true; })()",
    );
    await delay(400);
    report["ionSelectMenu"] = await probe(
      "(() => { const host = document.querySelector('[class*=contentBody] ion-settings-panel'); const shadow = host?.shadowRoot; const menu = shadow?.querySelector('.ion-select-menu'); const trigger = shadow?.querySelector('[aria-label=\"Display server\"]'); if (!menu || !trigger) return null; const m = menu.getBoundingClientRect(); const t = trigger.getBoundingClientRect(); const anchored = (Math.abs(m.top - (t.bottom + 4)) <= 2 || Math.abs(m.bottom - (t.top - 4)) <= 2) && Math.abs(m.left - t.left) <= 2; return { position: getComputedStyle(menu).position, anchored, below: m.top > t.bottom, withinViewport: m.top >= 0 && m.bottom <= window.innerHeight && m.left >= 0 && m.right <= window.innerWidth }; })()",
    );
    const selectImage = await contents.capturePage().catch(() => null);
    if (selectImage && !selectImage.isEmpty()) {
      writeFileSync(join(outputDir, "screenshot-select.png"), selectImage.toPNG());
    }
    // Escape must dismiss the menu (no side effects left behind).
    await probe("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await delay(200);
    report["ionSelectEscapeClosed"] = await probe(
      "(() => { const host = document.querySelector('[class*=contentBody] ion-settings-panel'); return host?.shadowRoot?.querySelector('.ion-select-menu') === null; })()",
    );
    // The soak window, so the harness can tell a Tier 2 run from a quick one.
    report["settleMs"] = settleMs;
    writeFileSync(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    app.exit(0);
  }

  win.webContents.once("did-finish-load", () => {
    // The SPA needs a moment after load before the login UI is painted.
    setTimeout(() => void finish("did-finish-load"), settleMs);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    void finish(`render-process-gone: ${details.reason}`);
  });
}
