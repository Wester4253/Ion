/**
 * The Ion debug panel: a small, isolated status widget injected into the page.
 *
 * Plain DOM inside a shadow root (no framework — this is a diagnostic tool;
 * the product UI in packages/ui uses Preact). All colors, fonts, radii, and
 * motion come from Discord's own CSS custom properties, so the widget matches
 * the user's theme (including light mode) without shipping any palette.
 *
 * Placement: the trigger docks into Discord's user panel, right before the
 * settings gear (queried by aria-label, so it survives class churn). If the
 * gear never appears — the login page, or a Discord redesign — it falls back
 * to a floating button above the user panel area after a deadline.
 */

import type { IonPluginStatus, IonWebpackStatus } from "./platform/shell";

const HOST_TAG = "ion-debug-host";

/** Latest statuses and the mounted root, so polls can update the panel. */
let latestWebpack: IonWebpackStatus | undefined;
let latestPlugins: IonPluginStatus | undefined;
let panelRoot: ShadowRoot | undefined;

/**
 * The gear button is the last (right-most) button of the user panel's button
 * row — structural, so it survives locales; the English aria-label is only a
 * fallback for when the structure itself changes.
 */
const GEAR_SELECTORS = [
  "[class*=panels] [class*=buttons] > button:last-of-type",
  '[aria-label="User Settings"]',
];
const DOCK_DEADLINE_MS = 20_000;

const BOLT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
  <path d="M13 2 4.5 13.5H11L9.5 22 18 10.5H11.5L13 2Z"/>
</svg>`;

const SHADOW_CSS = `
  :host { all: initial; display: contents; }
  * { box-sizing: border-box; }

  .trigger {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 4px;
    padding: 0;
    cursor: pointer;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--interactive-normal, #b5bac1);
    transition: color 150ms ease, background-color 150ms ease;
  }
  .trigger:hover {
    color: var(--interactive-hover, #dbdee1);
    background: var(--background-mod-hover, rgb(78 80 88 / 40%));
  }
  .trigger:focus-visible {
    outline: 2px solid var(--focus-primary, #00a8fc);
    outline-offset: 1px;
  }
  .trigger svg { width: 20px; height: 20px; }

  :host([data-mode="floating"]) .trigger {
    position: fixed;
    left: 12px;
    bottom: 76px;
    z-index: 2147483647;
    border-radius: 50%;
    background: var(--background-floating, #111214);
    box-shadow: var(--elevation-2, 0 8px 16px rgb(0 0 0 / 24%));
    opacity: 0.55;
  }
  :host([data-mode="floating"]) .trigger:hover { opacity: 1; }

  /* Between mount and the dock decision the trigger must not flash into flow. */
  :host([data-mode="pending"]) .trigger { visibility: hidden; }

  /* Floating mode: lift the popover above the floating trigger. */
  :host([data-mode="floating"]) .panel { bottom: 116px; }

  .panel {
    position: fixed;
    left: 12px;
    bottom: 76px;
    z-index: 2147483647;
    min-width: 268px;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--background-floating, #111214);
    color: var(--text-normal, #dbdee1);
    box-shadow: var(--elevation-3, 0 16px 24px rgb(0 0 0 / 32%));
    font: 14px/1.4 var(--font-primary, inherit);
    opacity: 0;
    transform: translateY(6px);
    pointer-events: none;
    transition: opacity 150ms ease, transform 150ms ease;
  }
  .panel[data-open="true"] { opacity: 1; transform: none; pointer-events: auto; }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-weight: 600;
    color: var(--header-primary, #f2f3f5);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-positive, #23a559);
  }
  .dot[data-state="error"] { background: var(--status-danger, #f23f43); }

  .row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 3px 0;
    font-size: 13px;
    color: var(--text-secondary, #b5bac1);
  }
  .row b { font-weight: 500; color: var(--text-normal, #dbdee1); }
`;

const SHADOW_HTML = `
<style>${SHADOW_CSS}</style>
<button class="trigger" type="button" title="Ion debug panel" aria-label="Ion debug panel">${BOLT_ICON}</button>
<div class="panel" data-open="false" role="dialog" aria-label="Ion debug panel">
  <div class="title"><span class="dot"></span><span data-field="title">Ion</span></div>
  <div class="row"><span>Status</span><b data-field="status">—</b></div>
  <div class="row"><span>Injection</span><b data-field="injection">—</b></div>
  <div class="row"><span>Shell</span><b data-field="shell">—</b></div>
  <div class="row"><span>Webpack</span><b data-field="webpack">starting…</b></div>
  <div class="row"><span>Plugins</span><b data-field="plugins">loading…</b></div>
</div>
`;

function setField(root: ShadowRoot, field: string, text: string): void {
  const element = root.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (element) element.textContent = text;
}

function setError(root: ShadowRoot, text: string): void {
  setField(root, "status", text);
  const dot = root.querySelector<HTMLElement>(".dot");
  if (dot) dot.dataset["state"] = "error";
}

function formatWebpack(status: IonWebpackStatus): string {
  if (!status.hooked) return "not hooked";
  if (!status.ready) return "starting…";
  const finds = status.byProps && status.store ? "finds OK" : "finds pending";
  return `${String(status.factories)} factories · ${finds}`;
}

/** Push a fresh webpack status into the panel (no-op before it mounts). */
export function updateWebpackStatus(status: IonWebpackStatus): void {
  latestWebpack = status;
  if (panelRoot) setField(panelRoot, "webpack", formatWebpack(status));
}

function formatPlugins(status: IonPluginStatus): string {
  const failed = status.failed > 0 ? ` · ${String(status.failed)} failed` : "";
  return `${String(status.started)}/${String(status.registered)} started${failed}`;
}

/** Push a fresh plugin-host status into the panel (no-op before it mounts). */
export function updatePluginStatus(status: IonPluginStatus): void {
  latestPlugins = status;
  if (panelRoot) setField(panelRoot, "plugins", formatPlugins(status));
}

function setPanelOpen(root: ShadowRoot, open: boolean): void {
  const panel = root.querySelector<HTMLElement>(".panel");
  if (panel) panel.dataset["open"] = open ? "true" : "false";
}

/** Attach to the user panel next to the gear, or fall back to floating. */
function dock(host: HTMLElement): void {
  const attempt = (): boolean => {
    for (const selector of GEAR_SELECTORS) {
      const gear = document.querySelector(selector);
      const parent = gear?.parentElement;
      if (gear && parent) {
        parent.insertBefore(host, gear);
        host.dataset["mode"] = "docked";
        return true;
      }
    }
    return false;
  };

  if (attempt()) return;

  let settled = false;
  const observer = new MutationObserver(() => {
    if (!settled && attempt()) {
      settled = true;
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.setTimeout(() => {
    if (settled) return;
    settled = true;
    observer.disconnect();
    host.dataset["mode"] = "floating";
  }, DOCK_DEADLINE_MS);
}

function boot(): void {
  const state = window.__ION__;
  if (state == null) return;
  if (document.getElementsByTagName(HOST_TAG).length > 0) return;

  const host = document.createElement(HOST_TAG);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = SHADOW_HTML;
  panelRoot = root;
  if (latestWebpack) setField(root, "webpack", formatWebpack(latestWebpack));
  if (latestPlugins) setField(root, "plugins", formatPlugins(latestPlugins));

  const trigger = root.querySelector<HTMLButtonElement>(".trigger");
  const panel = root.querySelector<HTMLElement>(".panel");
  trigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPanelOpen(root, panel?.dataset["open"] !== "true");
  });

  // Native popover behavior: click away or Escape dismisses.
  document.addEventListener("click", () => {
    setPanelOpen(root, false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setPanelOpen(root, false);
  });
  panel?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  setField(root, "title", `Ion ${state.version}`);
  setField(root, "injection", `main world (T+${String(Math.round(state.startedAt))}ms)`);

  const shell = window.ionShell;
  if (shell == null) {
    setError(root, "bridge missing");
    setField(root, "shell", "none");
  } else {
    setField(root, "status", "injected");
    setField(root, "shell", `${shell.kind} · ${shell.appVersion}`);
  }

  host.dataset["mode"] = "pending";
  document.body.appendChild(host);
  dock(host);
}

/** Mount once the document exists; called by the core bundle entry point. */
export function mountDebugPanel(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
