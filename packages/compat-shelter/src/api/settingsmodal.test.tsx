// @vitest-environment jsdom
/**
 * The two settings dialogs a plugin can open.
 *
 * jsdom rather than happy-dom for the reason spelled out in
 * `reactiveroot.test.tsx`: only jsdom builds the custom element the way
 * Chromium does, and the modals are rendered through it.
 *
 * Both dialogs are upstream's `src/plugins.tsx` shapes (see the file header),
 * driven through shelter-ui's own `openModal` so the test exercises the real
 * modal stack: signal → `<ModalRoot>` appended to `document.body` → `<dialog>`
 * shown. Closing goes through the 250 ms `popSpecificModal` timer upstream
 * uses, so the assertions wait it out rather than reach into that module.
 */
import { describe, expect, it, afterEach } from "vitest";
import { openModal } from "@uwu/shelter-ui";
import type { JSX } from "solid-js";
import { openSettingsModal, openSettingsModalAndWait } from "./settingsmodal";

/** One tick past upstream's 250 ms close animation. */
const CLOSED = 300;

const settingsBody = (): JSX.Element => <div>settings body</div>;

/**
 * jsdom implements `<dialog>` and its `open` attribute but leaves out
 * `showModal`, which the modal stack calls as soon as the root renders. Give
 * it the one thing the tests observe — the open flag — instead of skipping
 * the modals entirely.
 */
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement): void {
      this.open = true;
    },
  });
}

function dialogs(): HTMLDialogElement[] {
  return Array.from(document.querySelectorAll<HTMLDialogElement>("shltr-rroot dialog"));
}

/** The one dialog a test just opened, or a failed assertion. */
function onlyDialog(): HTMLDialogElement {
  const [dialog] = dialogs();
  expect(dialog).toBeDefined();
  if (dialog === undefined) throw new Error("no dialog was opened");
  return dialog;
}

/**
 * The modal stack is module state, so one test's dialog would still be open
 * in the next. `cancel` is the dialog's own dismiss and takes the same 250 ms
 * path a real one does.
 */
afterEach(async () => {
  for (const dialog of dialogs()) {
    if (dialog.open) dialog.dispatchEvent(new Event("cancel"));
  }
  await new Promise((resolve) => setTimeout(resolve, CLOSED));
  expect(dialogs()).toHaveLength(0);
});

describe("openSettingsModal", () => {
  it("mounts a titled dialog whose Done button closes it", async () => {
    openSettingsModal(openModal, "Test plugin", settingsBody);

    const dialog = onlyDialog();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("Settings - Test plugin");
    expect(dialog.textContent).toContain("settings body");

    const done = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Done",
    );
    expect(done).toBeDefined();

    done?.click();
    await new Promise((resolve) => setTimeout(resolve, CLOSED));
    expect(dialogs()).toHaveLength(0);
  });

  it("opens an empty dialog for a plugin with no settings component", () => {
    openSettingsModal(openModal, "No settings", undefined);

    const dialog = onlyDialog();
    expect(dialog.textContent).toContain("Settings - No settings");
    expect(dialog.textContent).not.toContain("settings body");
  });
});

describe("openSettingsModalAndWait", () => {
  it("has no Done footer and resolves once the dialog closes", async () => {
    let resolved = false;
    const opened = openSettingsModalAndWait(openModal, "Awaited", settingsBody).then(() => {
      resolved = true;
    });

    const dialog = onlyDialog();
    expect(
      Array.from(dialog.querySelectorAll("button")).some((button) => button.textContent === "Done"),
    ).toBe(false);
    expect(resolved).toBe(false);

    // Escape is this dialog's own dismiss: `cancel` → upstream's `popModal`.
    dialog.dispatchEvent(new Event("cancel"));
    await opened;
    expect(resolved).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, CLOSED));
    expect(dialogs()).toHaveLength(0);
  });
});
