// @vitest-environment happy-dom
/**
 * Unit tests for the DOM-based UI overlays: toast lifecycle, notice
 * mounting (into Discord's notice area, found through module discovery),
 * and the alert/confirmation modals — including their close paths, Escape
 * handling, backdrop dismissal, and listener cleanup.
 */

// Two tests assert on the warnings the overlays log for bad input; the
// compat harness attributes plugin failures by reading console output
// back, so referencing them is the point.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";

import { alertModal, showConfirmationModal, showNotice, showToast } from "./ui-overlays";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="app-mount"></div>';
  const discovery = {
    find: (filter: (exports: unknown) => boolean) => {
      const classes = { container: "container", base: "chat-base", sidebar: "sidebar" };
      return filter(classes) ? classes : undefined;
    },
    getRequires: () => [],
    waitFor: () => () => undefined,
  } as unknown as IonDiscoveryApi;
  (window as unknown as { __ION__: IonGlobal }).__ION__ = { discovery } as unknown as IonGlobal;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("showToast", () => {
  it("mounts under the app root and removes itself after the timeout", () => {
    showToast("Saved");

    const mount = document.querySelector("#app-mount #bd-toasts");
    expect(mount).not.toBeNull();
    const toast = mount?.querySelector(".bd-toast");
    expect(toast?.querySelector("span")?.textContent).toBe("Saved");
    // Untyped toasts carry no type class and no icon.
    expect(toast?.className).toBe("bd-toast");

    vi.advanceTimersByTime(2999);
    expect(mount?.querySelector(".bd-toast")).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(mount?.querySelector(".bd-toast")).toBeNull();
  });

  it("styles typed toasts and honors icon/timeout options", () => {
    showToast("Uploaded", { type: "success", timeout: 500 });
    const mount = document.querySelector("#bd-toasts");
    const toast = mount?.querySelector(".bd-toast");
    expect(toast?.className).toContain("toast-success");
    expect(toast?.querySelector("svg")).not.toBeNull();

    showToast("Careful", { type: "warning", icon: false, timeout: 500 });
    const warning = Array.from(mount?.querySelectorAll(".bd-toast") ?? []).at(-1);
    expect(warning?.className).toContain("toast-warning");
    expect(warning?.querySelector("svg")).toBeNull();

    vi.advanceTimersByTime(500);
    expect(mount?.querySelectorAll(".bd-toast")).toHaveLength(0);
  });

  it("reuses one toast container", () => {
    showToast("One");
    showToast("Two");
    expect(document.querySelectorAll("#bd-toasts")).toHaveLength(1);
    expect(document.querySelectorAll(".bd-toast")).toHaveLength(2);
  });
});

describe("showNotice", () => {
  it("mounts into the notice area, closes immediately, and fires onClose", () => {
    document.body.innerHTML = '<div class="chat-base"></div>';

    const onClose = vi.fn();
    const close = showNotice("Update available", { type: "info", onClose });
    expect(close).toBeTypeOf("function");

    const notice = document.querySelector(".chat-base #bd-notices .bd-notice");
    expect(notice?.className).toContain("bd-notice-info");
    expect(notice?.querySelector(".bd-notice-content")?.textContent).toBe("Update available");

    close?.(true);
    expect(document.querySelector(".bd-notice")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("fades out on the animated close path", () => {
    document.body.innerHTML = '<div class="chat-base"></div>';
    const close = showNotice("Fading");

    close?.();
    const notice = document.querySelector(".bd-notice");
    expect(notice?.className).toContain("bd-notice-closing");
    expect(document.querySelector(".bd-notice")).not.toBeNull();
    vi.advanceTimersByTime(300);
    expect(document.querySelector(".bd-notice")).toBeNull();
  });

  it("renders buttons whose click receives the close callback", () => {
    document.body.innerHTML = '<div class="chat-base"></div>';
    const onClick = vi.fn();
    showNotice("Retry?", {
      buttons: [
        { label: "Retry", onClick },
        // Missing label: skipped.
        { label: "", onClick: vi.fn() },
      ],
    });

    const button = document.querySelector(".bd-notice-button");
    expect(button?.textContent).toBe("Retry");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).toHaveBeenCalledWith(expect.any(Function));
  });

  it("auto-closes after the timeout", () => {
    document.body.innerHTML = '<div class="chat-base"></div>';
    const onClose = vi.fn();
    showNotice("Timed", { timeout: 100, onClose });

    vi.advanceTimersByTime(100);
    expect(document.querySelector(".bd-notice")?.className).toContain("bd-notice-closing");
    vi.advanceTimersByTime(300);
    expect(document.querySelector(".bd-notice")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("returns undefined and warns when no container exists", () => {
    // No `.chat-base` element: nothing to mount into.
    expect(showNotice("Nowhere")).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("alertModal", () => {
  it("shows the title and content and closes on Okay", () => {
    alertModal("Ion", "Everything is fine.");

    const backdrop = document.querySelector(".bd-modal-backdrop");
    expect(backdrop).not.toBeNull();
    expect(document.querySelector(".bd-modal-title")?.textContent).toBe("Ion");
    expect(document.querySelector(".bd-modal-content")?.textContent).toBe("Everything is fine.");
    const confirm = document.querySelector(".bd-modal-footer .bd-button");
    expect(confirm?.textContent).toBe("Okay");
    // Alert modals have no cancel button.
    expect(document.querySelectorAll(".bd-modal-footer .bd-button")).toHaveLength(1);

    confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".bd-modal-backdrop")).toBeNull();
  });

  it("accepts mixed content and closes on Escape without stale listeners", () => {
    alertModal("Mixed", ["a", 5]);

    const backdrop = document.querySelector(".bd-modal-backdrop");
    expect(backdrop?.textContent).toContain("a");
    expect(backdrop?.textContent).toContain("5");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".bd-modal-backdrop")).toBeNull();

    // The keydown listener was removed with the modal; re-dispatching must
    // not throw or re-enter anything.
    expect(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    }).not.toThrow();
  });

  it("renders React-element content without Discord's React by warning", () => {
    alertModal("Element", { $$typeof: Symbol.for("react.element"), type: () => null });
    expect(document.querySelector(".bd-modal-title")?.textContent).toBe("Element");
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("showConfirmationModal", () => {
  it("fires onConfirm and onClose for the confirm button", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onClose = vi.fn();
    showConfirmationModal("Delete?", "This cannot be undone.", {
      confirmText: "Delete",
      cancelText: "Keep",
      danger: true,
      onConfirm,
      onCancel,
      onClose,
    });

    const confirm = document.querySelector(".bd-modal-footer .bd-button");
    expect(confirm?.textContent).toBe("Delete");
    expect(confirm?.className).toContain("bd-button-danger");
    expect(document.querySelectorAll(".bd-modal-footer .bd-button")[1]?.textContent).toBe("Keep");

    confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector(".bd-modal-backdrop")).toBeNull();
  });

  it("fires onCancel for the cancel button and for backdrop clicks", () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    showConfirmationModal("Sure?", "Content", { onCancel, onClose });

    const cancel = document.querySelectorAll(".bd-modal-footer .bd-button")[1];
    cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    const onCancelAgain = vi.fn();
    showConfirmationModal("Sure?", "Content", { onCancel: onCancelAgain });
    const backdrop = document.querySelector(".bd-modal-backdrop");
    backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCancelAgain).toHaveBeenCalledOnce();
    expect(document.querySelector(".bd-modal-backdrop")).toBeNull();
  });

  it("calls onCloseCallback immediately and applies extra classes", () => {
    const onCloseCallback = vi.fn();
    showConfirmationModal("Titled", "Body", { onCloseCallback, className: "plugin-modal" });
    expect(onCloseCallback).toHaveBeenCalledOnce();
    expect(document.querySelector(".bd-modal")?.className).toContain("plugin-modal");
  });
});
