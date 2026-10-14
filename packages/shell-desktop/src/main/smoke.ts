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
 * One captured console error plus where it came from.
 *
 * The origin is appended rather than stored beside the message so every
 * reader of `rendererErrors` — the run's health check, the scoreboard, the
 * owner reading a diff — sees one string and cannot quote an error without
 * its source. `sourceId` is the URL of the log source, which for code
 * evaluated under a `sourceURL` is the code itself, and for a Content
 * Security Policy refusal is the only clue the message carries.
 */
function withSource(message: string, sourceId: string): string {
  return sourceId.trim().length > 0 ? `${message} [source: ${sourceId}]` : message;
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
 * Ceiling on stored renderer errors. The capture is unbounded in memory
 * until this point, and a runaway `console.error` loop in the page could
 * otherwise grow the report without end over a three-minute soak — but a
 * dropped error must never disappear silently, so drops are counted and the
 * report carries the count; the harness treats any drop as unattributed
 * (nobody can be blamed for a message that was never seen), which keeps the
 * run unhealthy until the cap is raised.
 */
const MAX_RENDERER_ERRORS = 1000;

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
  {
    // Vencord's UserSettings store logs this when the settings catalog
    // module is missing. A logged-out page never loads it, and the plugins
    // whose start() forces it are already reported as start failures under
    // their own names.
    match: /Didn't find settings module/,
    reason: "The UserSettings catalog is absent on the logged-out page",
  },
  {
    // ShikiCodeblocks.desktop pulls a devicon stylesheet from a CDN;
    // Discord's style-src CSP refuses it, so the plugin renders without
    // those icons and names no plugin in the browser's refusal line.
    match: /devicons\/devicon@[^']+\/devicon\.min\.css/,
    reason: "ShikiCodeblocks' devicon stylesheet is refused by Discord's CSP",
  },
  {
    // USRBG fetches its background list from its own service; Discord's
    // connect-src CSP refuses it (both the connection line and the Fetch
    // API line carry the URL). The plugin logs its own attributed
    // rejection alongside these browser-level refusals.
    match: /usrbg\.is-hardly\.online/,
    reason: "USRBG's service is refused by Discord's connect-src CSP",
  },
  {
    // WebRichPresence (arRPC) opens its bridge socket at start; the bridge
    // app is not installed on the machine under test, so the connection
    // is refused and the plugin logs its own attributed rejection beside it.
    match: /WebSocket connection to 'ws:\/\/127\.0\.0\.1:1337\/' failed/,
    reason: "The local arRPC bridge on 127.0.0.1:1337 is not running on the machine under test",
  },
  {
    // XSOverlay opens its helper-app socket at start; the XSOverlay app is
    // not installed on the machine under test, so the connection is
    // refused and the plugin logs its own attributed rejection beside it.
    match: /WebSocket connection to 'ws:\/\/127\.0\.0\.1:42070\/\?client=Vencord' failed/,
    reason: "XSOverlay needs the XSOverlay app listening on 127.0.0.1:42070",
  },
  {
    // DiscordFeed injects JetBrains Mono as a stylesheet; Discord's
    // style-src does not list Google Fonts and the shell grants nothing
    // Google. The refusal is browser-level and non-fatal — the plugin runs
    // and only the font substitution is lost — so it is recorded as an
    // expected environment refusal rather than pinned on the plugin.
    match: /fonts\.googleapis\.com\/css2\?family=JetBrains\+Mono/,
    reason: "DiscordFeed's JetBrains Mono stylesheet is refused by Discord's style-src CSP",
  },
  {
    // toki pona taso loads the ijo font from rawcdn.githack.com, which
    // Discord's font-src does not list. The same plugin is separately
    // reported (and fails) for its Pyodide script, which stays attributed —
    // only this browser-level refusal carries no plugin marker.
    match: /rawcdn\.githack\.com\/lipu-linku\/ijo/,
    reason: "toki pona taso's ijo font is refused by Discord's font-src CSP",
  },
  {
    // relationshipNotifier's start() fires syncAndRunChecks() without
    // awaiting it (vendor code, verbatim); where UserStore's module has
    // not loaded, the async body rejects and no plugin name survives into
    // the message. The plugins whose paths do this are still reported —
    // by start failure or by their own attributed rejections — and this
    // shape has exactly one cause: reading the store before it exists.
    match: /Cannot read properties of undefined \(reading 'getCurrentUser'\)/,
    reason: "A plugin read UserStore before the store module loaded",
  },
];

export function parseSmokeArg(argv: readonly string[]): string | null {
  const arg = argv.find((entry) => entry.startsWith("--ion-smoke"));
  if (!arg) return null;
  const value = arg.slice("--ion-smoke".length);
  return value.startsWith("=") && value.length > 1 ? value.slice(1) : ".";
}

/** Console evidence collected during a smoke run. */
export interface SmokeCapture {
  readonly rendererErrors: string[];
  readonly expectedErrors: Map<string, number>;
  readonly warnings: Set<string>;
  /** Renderer errors dropped at the capture cap — zero in any healthy run. */
  dropped(): number;
  detach(): void;
}

interface ConsoleArg {
  readonly value?: unknown;
  readonly description?: string;
  readonly unserializableValue?: string;
}

interface ConsoleCall {
  readonly type: string;
  readonly args: readonly ConsoleArg[];
  readonly stackTrace?: { readonly callFrames?: readonly { readonly url?: string }[] };
}

interface ExceptionDetails {
  readonly text?: string;
  readonly url?: string;
  readonly exception?: { readonly description?: string };
}
interface LogEntry {
  readonly level?: string;
  readonly text?: string;
  readonly url?: string;
}

/** Text of one console argument: primitives as-is, anything else as JSON. */
function argText(arg: ConsoleArg): string {
  const value = arg.value ?? arg.description ?? arg.unserializableValue;
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Attach console capture to a window. Console capture goes over the debugger
 * protocol rather than the `console-message` event: Chromium truncates that
 * event's text at ~160 characters, which a styled Vencord log line spends
 * entirely on CSS — the message body (the plugin name a failure can be
 * attributed to) never survives the trip. Three event sources together
 * cover what that event used to: JS `console.error`/`console.warn` calls,
 * uncaught exceptions and promise rejections, and browser-originated entries
 * (Content Security Policy refusals, network failures), each with the full
 * text.
 *
 * The caller runs this before navigation (see `beforeLoad`); the attach and
 * the domain enables wait for navigation to start because operating on a
 * documentless target throws (or worse). That still wins the race by orders
 * of magnitude: document-start scripts run only after the fetch, the parse,
 * and the commit that follow this event. When the debugger cannot attach,
 * capture falls back to the `console-message` event instead of going dark.
 */
export function attachSmokeCapture(win: BrowserWindow): SmokeCapture {
  // Renderer errors (including uncaught exceptions) go into the report.
  // Console errors that are by design of the bundled software are counted
  // separately — that list stays tiny and every entry carries its reason.
  const rendererErrors: string[] = [];
  let rendererErrorsDropped = 0;
  const expectedErrors = new Map<string, number>();
  const warnings = new Set<string>();

  const record = (level: "error" | "warning", message: string, sourceId: string): void => {
    if (message.trim().length === 0) return;
    if (level === "warning") {
      if (warnings.size < MAX_WARNINGS) warnings.add(withSource(message, sourceId));
      return;
    }
    const expected = EXPECTED_ERRORS.find((entry) => entry.match.test(message));
    if (expected) {
      expectedErrors.set(expected.reason, (expectedErrors.get(expected.reason) ?? 0) + 1);
      return;
    }
    // Carry where it came from. A message on its own says what broke; the
    // source says whose it was, which is the difference between blaming a
    // plugin and blaming the run. For code eval'd under a `sourceURL` that
    // is the plugin itself, and for a Content Security Policy refusal it is
    // the only clue the message has. Past the cap the message is counted
    // instead of stored — see MAX_RENDERER_ERRORS.
    if (rendererErrors.length >= MAX_RENDERER_ERRORS) {
      rendererErrorsDropped += 1;
      return;
    }
    rendererErrors.push(withSource(message, sourceId));
  };

  const useFallbackCapture = (): SmokeCapture => {
    win.webContents.on("console-message", (details) => {
      if (details.level === "warning") record("warning", details.message, details.sourceId);
      else if (details.level === "error") record("error", details.message, details.sourceId);
    });
    return {
      rendererErrors,
      expectedErrors,
      warnings,
      dropped: () => rendererErrorsDropped,
      detach: () => undefined,
    };
  };

  // Attaching to a documentless target throws, and enabling a domain on
  // one crashes the renderer, so the attach and the enables all wait for
  // navigation to start. That still wins the race by orders of magnitude:
  // document-start scripts run only after the fetch, the parse, and the
  // commit that follow this event.
  const detach = (): void => {
    try {
      win.webContents.debugger.detach();
    } catch {
      // Already detached (window closed); capture is over either way.
    }
  };
  const onMessage = (_event: unknown, method: string, params: unknown): void => {
    if (method === "Runtime.consoleAPICalled") {
      const call = params as ConsoleCall;
      const level = call.type === "error" ? "error" : call.type === "warning" ? "warning" : null;
      if (level === null) return;
      const message = call.args.map(argText).join(" ").trim();
      record(level, message, call.stackTrace?.callFrames?.[0]?.url ?? "");
      return;
    }
    if (method === "Runtime.exceptionThrown") {
      const details = (params as { exceptionDetails?: ExceptionDetails }).exceptionDetails;
      if (!details) return;
      record(
        "error",
        [details.text, details.exception?.description].filter(Boolean).join(" "),
        details.url ?? "",
      );
      return;
    }
    if (method === "Log.entryAdded") {
      const entry = (params as { entry?: LogEntry }).entry;
      if (!entry) return;
      const level =
        entry.level === "error" ? "error" : entry.level === "warning" ? "warning" : null;
      if (level === null || !entry.text) return;
      record(level, entry.text, entry.url ?? "");
    }
  };
  win.webContents.once("did-start-loading", () => {
    void (async () => {
      const debug = process.env["ION_SMOKE_DEBUG"] === "1";
      try {
        win.webContents.debugger.attach("1.3");
      } catch (error) {
        if (debug) console.error(`[ion-smoke] debugger attach failed: ${String(error)}`);
        useFallbackCapture();
        return;
      }
      win.webContents.debugger.on("message", onMessage);
      try {
        // Both domains must be on or the capture is partial in a way that
        // cannot be told from the outside; a failed enable falls back to
        // the event entirely rather than mix two capture paths. Console
        // calls and uncaught exceptions arrive over the Runtime domain,
        // browser-side refusals over Log.
        await win.webContents.debugger.sendCommand("Runtime.enable");
        await win.webContents.debugger.sendCommand("Log.enable");
        if (debug) console.error("[ion-smoke] CDP capture enabled (Runtime, Log)");
      } catch (error) {
        if (debug) console.error(`[ion-smoke] domain enable failed: ${String(error)}`);
        win.webContents.debugger.removeListener("message", onMessage);
        detach();
        useFallbackCapture();
      }
    })();
  });
  return {
    rendererErrors,
    expectedErrors,
    warnings,
    dropped: () => rendererErrorsDropped,
    detach,
  };
}

export function runSmoke(
  outputDir: string,
  win: BrowserWindow,
  capture: SmokeCapture,
  options: { readonly settleMs?: number | undefined } = {},
): void {
  mkdirSync(outputDir, { recursive: true });

  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const timer = setTimeout(() => void finish("timeout"), settleMs + FALLBACK_MARGIN_MS);

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const { rendererErrors, expectedErrors, warnings } = capture;

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
    capture.detach();
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
        "window.__ION__ && window.__ION__.plugins ? { status: window.__ION__.plugins.status(), ids: window.__ION__.plugins.list().map(p => `${p.id}:${p.state}`), failures: window.__ION__.plugins.list().filter(p => p.error).map(p => ({ id: p.id, error: p.error })), names: window.__ION__.plugins.list().reduce((acc, p) => { acc[p.id] = p.name; return acc; }, {}) } : null",
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
    report["rendererErrors"] = rendererErrors;
    const dropped = capture.dropped();
    if (dropped > 0) report["rendererErrorsDropped"] = dropped;
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
