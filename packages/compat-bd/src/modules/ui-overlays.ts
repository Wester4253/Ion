/**
 * BetterDiscord's user-facing overlays, implemented as DOM layers styled
 * with Discord's own CSS variables.
 *
 * Upstream renders its toasts, notices, and modals through React — Discord's
 * modal system for `alert`/`showConfirmationModal`, a floating React layer
 * for toasts. Ion's adapter builds the same shapes from DOM instead: the
 * styling (colors, radii, elevation, fonts) comes from Discord's live CSS
 * variables, so the result follows Discord's theme and looks native, while
 * the implementation stays independent of Discord's internal modal
 * components — which change between releases and would silently break
 * plugins. The deviation is recorded in THIRD_PARTY.md.
 *
 * Toast and notice styling follows BetterDiscord's own stylesheet
 * (Apache-2.0), ported where it maps onto Discord's current variables.
 */

import { clsx } from "../common/clsx";
import { Logger } from "../common/logger";
import { DOMManager } from "./dommanager";
import {
  getNoticesBaseClasses,
  getNoticesPageClasses,
  getReact,
  getReactDOM,
  type BdReact,
} from "./discord-modules";

export type ToastType = "default" | "info" | "success" | "warning" | "error";

export interface ToastOptions {
  /** Changes the type of the toast stylistically and semantically. */
  type?: ToastType;
  /** Whether the icon shows for the typed toast. */
  icon?: boolean;
  /** Milliseconds before the toast disappears; defaults to 3000. */
  timeout?: number;
  /** Accepted for compatibility; Ion has no BD settings store, so toasts always show. */
  forceShow?: boolean;
}

export type NoticeType = "info" | "error" | "warning" | "success";

export interface NoticeButton {
  label: string;
  /** Runs on click, receiving the notice's close callback. */
  onClick: (close: (immediate?: boolean) => void) => void;
}

export interface NoticeOptions {
  /** The type of the notice; affects the color. */
  type?: NoticeType;
  /** Buttons added next to the notice text. */
  buttons?: NoticeButton[];
  /** Milliseconds before auto-close; `0` (the default) keeps it open. */
  timeout?: number;
  /** Fired when the notice is closed. */
  onClose?: () => void;
}

export interface ConfirmationModalOptions {
  /** A callback to run when the modal exits, however it exits. */
  onClose?: () => void;
  /** A callback to run when clicking the submit button. */
  onConfirm?: () => void;
  /** A callback to run when clicking cancel or dismissing the modal. */
  onCancel?: () => void;
  /** Called immediately on render. */
  onCloseCallback?: () => void;
  /** Extra classes for the modal element. */
  className?: string;
  /** Text on the confirm button; defaults to "Okay". */
  confirmText?: string;
  /** Text on the cancel button; defaults to "Cancel". */
  cancelText?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
}

/** Strings, DOM nodes, and React elements all render into a modal body. */
export type ModalContent = string | number | Node | Record<string, unknown>;

const STYLE_ID = "ion-bd-ui-overlays";

const OVERLAY_CSS = `
#bd-toasts {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  pointer-events: none;
  z-index: 1003;
  position: absolute;
  padding-bottom: 40px;
  gap: 10px;
  inset: 0;
}

.bd-toast {
  --toast-bg: hsl(218, calc(var(--saturation-factor, 1) * 14%), 15%);
  --toast-fg: var(--text-default, #dbdee1);

  display: flex;
  align-items: center;
  pointer-events: none;
  user-select: none;
  overflow: hidden;
  flex-shrink: 0;
  background-color: var(--toast-bg);
  border-radius: var(--radius-xl, 16px);
  box-shadow: var(--shadow-high, 0 8px 16px rgba(0, 0, 0, 0.24));
  color: var(--toast-fg);
  font-size: 16px;
  font-weight: 500;
  padding: 5px;
  font-family: var(--font-primary);
}

.bd-toast span,
.bd-toast svg {
  padding: 5px;
}

.bd-toast svg {
  width: 20px;
  height: 20px;
  stroke: var(--toast-fg);
  flex-shrink: 0;
}

.bd-toast.toast-info {
  --toast-bg: hsl(219, calc(var(--saturation-factor, 1) * 29%), 13%);
  --toast-fg: hsl(216, calc(var(--saturation-factor, 1) * 76%), 57%);
}

.bd-toast.toast-success {
  --toast-bg: hsl(168, calc(var(--saturation-factor, 1) * 24%), 12%);
  --toast-fg: hsl(145, calc(var(--saturation-factor, 1) * 54%), 49%);
}

.bd-toast.toast-warning {
  --toast-bg: hsl(37, calc(var(--saturation-factor, 1) * 22%), 14%);
  --toast-fg: hsl(43, calc(var(--saturation-factor, 1) * 96%), 56%);
}

.bd-toast.toast-error {
  --toast-bg: hsl(337, calc(var(--saturation-factor, 1) * 21%), 12%);
  --toast-fg: hsl(0, calc(var(--saturation-factor, 1) * 54%), 60%);
}

#bd-notices {
  grid-area: notice;
}

.bd-notice-success {
  --color: var(--status-positive, #23a55a);
}

.bd-notice-error {
  --color: var(--status-danger, #f23f43);
}

.bd-notice-info {
  --color: var(--brand-500, #5865f2);
}

.bd-notice-warning {
  --color: var(--status-warning, #f0b232);
}

@keyframes bd-open-notice {
  from {
    height: 0;
  }
}

.bd-notice-closing {
  transition: height 400ms ease;
  height: 0 !important;
}

.bd-notice {
  animation: bd-open-notice 400ms ease;
  overflow: hidden;
  height: 36px;
  font-size: 14px;
  line-height: 36px;
  font-weight: 500;
  text-align: center;
  position: relative;
  padding-left: 4px;
  padding-right: 28px;
  z-index: 101;
  flex-shrink: 0;
  flex-grow: 0;
  box-shadow: var(--elevation-low, 0 1px 0 rgba(4, 4, 5, 0.2), 0 1.5px 0 rgba(6, 6, 7, 0.05), 0 2px 0 rgba(4, 4, 5, 0.05));
  color: #FFFFFF;
  background: var(--color, var(--brand-600, var(--brand-500, #5865f2)));
  font-family: var(--font-primary);
}

.bd-notice-close {
  position: absolute;
  top: 0;
  right: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
  transition: opacity 0.2s;
  cursor: pointer;
}

.bd-notice-close svg {
  width: 10px;
  height: 10px;
  stroke: #FFFFFF;
}

.bd-notice-close:hover {
  opacity: 1;
}

.bd-notice-button {
  font-size: 14px;
  font-weight: 500;
  position: relative;
  top: 6px;
  border: 1px solid;
  color: #FFFFFF;
  border-radius: 3px;
  height: 24px;
  padding: 0 10px;
  box-sizing: border-box;
  display: inline-block;
  vertical-align: top;
  margin-left: 10px;
  line-height: 22px;
  transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
  border-color: #FFFFFF;
  background: transparent;
  cursor: pointer;
  font-family: var(--font-primary);
}

.bd-notice-button:hover {
  color: var(--background-secondary, #2b2d31);
  background: #FFFFFF;
}

.bd-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10002;
  background: var(--black-50, rgba(0, 0, 0, 0.5));
  display: flex;
  align-items: center;
  justify-content: center;
  animation: bd-modal-fade 150ms ease;
}

@keyframes bd-modal-fade {
  from {
    opacity: 0;
  }
}

.bd-modal {
  background: var(--modal-background, var(--background-primary, #313338));
  border-radius: var(--radius-medium, 8px);
  box-shadow: var(--elevation-high, 0 8px 16px rgba(0, 0, 0, 0.24));
  width: 440px;
  max-width: calc(100vw - 32px);
  padding: 16px;
  box-sizing: border-box;
  font-family: var(--font-primary);
}

.bd-modal-title {
  font-family: var(--font-display, var(--font-primary));
  font-size: 20px;
  font-weight: 600;
  color: var(--header-primary, #f2f3f5);
  text-transform: uppercase;
  line-height: 24px;
  margin-bottom: 8px;
  overflow-wrap: break-word;
}

.bd-modal-content {
  font-size: 16px;
  line-height: 20px;
  color: var(--text-normal, #dbdee1);
}

.bd-modal-content p {
  margin: 0 0 8px;
}

.bd-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.bd-button {
  height: 38px;
  padding: 0 16px;
  border: none;
  border-radius: 3px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--font-primary);
  transition: background-color 0.17s ease;
}

.bd-button-brand {
  background: var(--button-filled-brand-background, var(--brand-500, #5865f2));
  color: var(--button-filled-brand-text, #FFFFFF);
}

.bd-button-brand:hover {
  background: var(--button-filled-brand-background-hover, var(--brand-560, #4752c4));
}

.bd-button-danger {
  background: var(--button-filled-danger-background, var(--status-danger, #da373c));
  color: var(--button-filled-danger-text, #FFFFFF);
}

.bd-button-danger:hover {
  background: var(--button-filled-danger-background-hover, #a12d2f);
}

.bd-button-secondary {
  background: var(--button-secondary-background, var(--background-modifier-accent, #4e5058));
  color: var(--button-secondary-text, #dbdee1);
}

.bd-button-secondary:hover {
  background: var(--button-secondary-background-hover, #6d6f78);
}

/* Discord's link-look buttons: no chrome, underlined on hover. */
.bd-button-link {
  background: transparent;
  color: var(--text-normal, #dbdee1);
}

.bd-button-link:hover {
  text-decoration: underline;
}
`;

const TOAST_ICONS: Partial<Record<ToastType, string>> = {
  info: '<svg viewBox="0 0 20 20" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M10 9.5v4"/><path d="M10 6.5h.01"/></svg>',
  success:
    '<svg viewBox="0 0 20 20" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M6.5 10.5 9 13l4.5-5"/></svg>',
  warning:
    '<svg viewBox="0 0 20 20" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 2.5 16.5h15Z"/><path d="M10 8.5v3"/><path d="M10 14h.01"/></svg>',
  error:
    '<svg viewBox="0 0 20 20" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M7.5 7.5 12.5 12.5"/><path d="M12.5 7.5 7.5 12.5"/></svg>',
};

const CLOSE_ICON =
  '<svg viewBox="0 0 10 10" fill="none" stroke-width="1.5" stroke-linecap="round"><path d="M1 1 9 9"/><path d="M9 1 1 9"/></svg>';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  DOMManager.injectStyle(STYLE_ID, OVERLAY_CSS);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const child of children) {
    if (typeof child === "string") element.append(document.createTextNode(child));
    else element.append(child);
  }
  return element;
}

function isReactElement(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && "$$typeof" in value;
}

/**
 * Appends content into `container`: strings and numbers as text, DOM nodes
 * directly, and React elements through Discord's react-dom. Returns a
 * cleanup for any mounted React root.
 */
function renderInto(container: HTMLElement, content: unknown): () => void {
  const reactChildren: unknown[] = [];
  const append = (item: unknown): void => {
    // React renders null, undefined, and booleans as nothing; match that.
    if (item === null || item === undefined || typeof item === "boolean") return;
    if (typeof item === "string" || typeof item === "number" || typeof item === "bigint") {
      container.append(document.createTextNode(String(item)));
      return;
    }
    if (item instanceof Node) {
      container.append(item);
      return;
    }
    if (isReactElement(item)) {
      reactChildren.push(item);
      return;
    }
    // Symbols and unrecognized objects render nothing, as in React.
  };

  if (Array.isArray(content)) content.forEach(append);
  else append(content);

  if (reactChildren.length === 0) return () => undefined;

  let React: BdReact | undefined;
  let createRoot:
    ((container: Element) => { render(node: unknown): void; unmount(): void }) | undefined;
  try {
    // Touch members to force proxy evaluation; throws while unloaded.
    const react = getReact();
    const reactDOM = getReactDOM();
    const rootFactory: unknown = reactDOM.createRoot;
    if (typeof react.createElement === "function" && typeof rootFactory === "function") {
      React = react;
      createRoot = (container: Element): { render(node: unknown): void; unmount(): void } =>
        (
          rootFactory.bind(reactDOM) as (c: Element) => {
            render(n: unknown): void;
            unmount(): void;
          }
        )(container);
    }
  } catch {
    React = undefined;
    createRoot = undefined;
  }
  if (!React || !createRoot) {
    Logger.warn(
      "UI~renderContent",
      "React modal content needs Discord's react-dom; rendering the remaining content as text.",
    );
    return () => undefined;
  }

  const mount = document.createElement("div");
  container.append(mount);
  const root = createRoot(mount);
  root.render(React.createElement(React.Fragment, null, ...reactChildren));
  return () => {
    root.unmount();
  };
}

interface ModalButtonOptions {
  confirmText?: string | undefined;
  cancelText?: string | undefined;
  danger?: boolean | undefined;
  className?: string | undefined;
  onConfirm?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** Omit the cancel button (the alert case). */
  alertOnly?: boolean;
}

/** Presents the shared modal: header, rendered body, and footer buttons. */
function presentModal(title: string, content: unknown, options: ModalButtonOptions = {}): void {
  ensureStyles();

  const backdrop = el("div", "bd-modal-backdrop");
  const modal = el("div", clsx("bd-modal", options.className, options.danger && "bd-modal-danger"));
  const body = el("div", "bd-modal-content");

  const footer = el("div", "bd-modal-footer");
  const confirm = el(
    "button",
    clsx("bd-button", options.danger ? "bd-button-danger" : "bd-button-brand"),
    options.confirmText ?? "Okay",
  );
  const cancel = options.alertOnly
    ? undefined
    : el("button", "bd-button bd-button-link", options.cancelText ?? "Cancel");

  const cleanupContent = renderInto(body, content);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown);
    cleanupContent();
    backdrop.remove();
    options.onClose?.();
  };
  const dismiss = (): void => {
    options.onCancel?.();
    close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") dismiss();
  };

  confirm.onclick = (): void => {
    options.onConfirm?.();
    close();
  };
  if (cancel) {
    cancel.onclick = (): void => {
      dismiss();
    };
  }
  backdrop.onclick = (event): void => {
    if (event.target === backdrop) dismiss();
  };
  document.addEventListener("keydown", onKeyDown);

  modal.append(el("div", "bd-modal-title", title), body);
  // Upstream BD renders the confirm button first and the (link-look) cancel
  // after it; mirror that order so the DOM matches Discord's own modals.
  footer.append(confirm);
  if (cancel) footer.append(cancel);
  modal.append(footer);
  backdrop.append(modal);
  document.body.append(backdrop);

  // Discord focuses the confirm button on open; do the same.
  confirm.focus();
}

/**
 * Shows a toast at the bottom center of the screen, Android-style — the
 * same placement and palette as BetterDiscord's own toasts.
 */
export function showToast(content: string, options: ToastOptions = {}): void {
  try {
    ensureStyles();
    const { type = "default", icon = true, timeout = 3000 } = options;

    let mount = document.getElementById("bd-toasts");
    if (!mount) {
      const created = el("div");
      created.id = "bd-toasts";
      (document.getElementById("app-mount") ?? document.body).append(created);
      mount = created;
    }

    const toast = el("div", clsx("bd-toast", type !== "default" && `toast-${type}`));
    const iconMarkup = icon ? TOAST_ICONS[type] : undefined;
    if (iconMarkup) {
      const holder = document.createElement("span");
      holder.innerHTML = iconMarkup;
      const svg = holder.firstElementChild;
      if (svg) toast.append(svg);
    }
    toast.append(el("span", undefined, content));
    mount.append(toast);

    window.setTimeout(() => {
      toast.remove();
    }, timeout);
  } catch (error) {
    Logger.stacktrace("Toasts", "Unable to show toast", error as Error);
  }
}

let noticesWatchingContainer = false;

function ensureNoticesContainer(): boolean {
  if (document.getElementById("bd-notices")) return true;

  const baseClass = getNoticesBaseClasses()?.base;
  if (!baseClass) return false;

  const container = document.querySelector(`.${baseClass}`);
  if (!container) return false;

  const noticeContainer = el("div");
  noticeContainer.id = "bd-notices";
  container.prepend(noticeContainer);

  if (!noticesWatchingContainer) {
    noticesWatchingContainer = true;
    DOMManager.onRemoved(container, () => {
      // The chat column was replaced (error page, etc.): follow it. The
      // error-page container appears later, so wait for it and re-mount.
      const errorPageClass = getNoticesPageClasses()?.errorPage;
      if (!errorPageClass) return;
      void DOMManager.onAdded(`.${errorPageClass}`, (element) => {
        element.prepend(noticeContainer);
      });
    });
  }

  return true;
}

/**
 * Shows a notice above Discord's chat layer — the same bar BetterDiscord
 * shows, mounted the same way (into Discord's notice grid area).
 *
 * @returns A callback that closes the notice; `true` closes immediately.
 */
export function showNotice(
  content: string,
  options: NoticeOptions = {},
): ((immediate?: boolean) => void) | undefined {
  const { type, buttons = [], timeout = 0, onClose } = options;

  ensureStyles();
  if (!ensureNoticesContainer()) {
    Logger.warn("Notices~show", "Could not find a container to mount the notice in.");
    return undefined;
  }

  const noticeElement = el("div", clsx("bd-notice", type && `bd-notice-${type}`));

  const closeNotification = (immediately = false): void => {
    onClose?.();
    if (immediately) {
      noticeElement.remove();
      return;
    }
    noticeElement.classList.add("bd-notice-closing");
    window.setTimeout(() => {
      noticeElement.remove();
    }, 300);
  };

  const closeButton = el("div", "bd-notice-close");
  closeButton.innerHTML = CLOSE_ICON;
  closeButton.addEventListener("click", () => {
    closeNotification(false);
  });

  noticeElement.append(closeButton, el("span", "bd-notice-content", content));

  for (const button of buttons) {
    const onClick = button.onClick;
    if (!button.label || typeof onClick !== "function") continue;
    const node = el("button", "bd-notice-button", button.label);
    node.addEventListener("click", () => {
      onClick(closeNotification);
    });
    noticeElement.append(node);
  }

  document.getElementById("bd-notices")?.append(noticeElement);

  if (timeout > 0) {
    window.setTimeout(() => {
      closeNotification(false);
    }, timeout);
  }

  return closeNotification;
}

/** Shows a generic modal with a single Okay button. */
export function alertModal(title: string, content: unknown): void {
  presentModal(title, content, { alertOnly: true });
}

/** Shows a confirmation modal with optional confirm and cancel callbacks. */
export function showConfirmationModal(
  title: string,
  content: unknown,
  options: ConfirmationModalOptions = {},
): void {
  const { onCloseCallback } = options;
  onCloseCallback?.();
  presentModal(title, content, {
    confirmText: options.confirmText,
    cancelText: options.cancelText,
    danger: options.danger,
    className: options.className,
    onConfirm: options.onConfirm,
    onCancel: options.onCancel,
    onClose: options.onClose,
  });
}
