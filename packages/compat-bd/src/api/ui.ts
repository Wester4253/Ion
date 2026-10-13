/**
 * `BdApi.UI` — BetterDiscord's interface surface. A port of
 * src/betterdiscord/api/ui.ts (Apache-2.0, see THIRD_PARTY.md).
 *
 * The toast, notice, alert, and confirmation surfaces are implemented as
 * DOM overlays styled with Discord's CSS variables (see
 * modules/ui-overlays.ts for the rationale). The remaining methods exist
 * for compatibility and log a warning naming themselves when called:
 * BetterDiscord implements them through React internals (its own settings
 * components, changelog modal, floating windows, tooltips) that this
 * adapter does not yet reproduce — a silent no-op would hide that from
 * plugin authors, and a crash would blame the plugin. The gap is listed in
 * docs/status.md.
 */

import { Logger } from "../common/logger";
import {
  alertModal,
  showConfirmationModal as presentConfirmationModal,
  showNotice as presentNotice,
  showToast as presentToast,
  type ConfirmationModalOptions,
  type ModalContent,
  type NoticeOptions,
  type ToastOptions,
} from "../modules/ui-overlays";

function unimplemented(method: string): void {
  Logger.warn(
    `BdApi.UI~${method}`,
    "Not implemented by Ion's BetterDiscord adapter yet; see docs/status.md.",
  );
}

export class UI {
  /**
   * Shows a generic but very customizable modal.
   *
   * @param title Title of the modal
   * @param content A string of text (or mixed content) to display
   */
  alert(title: string, content: ModalContent | readonly ModalContent[]): void {
    alertModal(title, content);
  }

  /**
   * Shows a customizable notification to the user, Android-toast style.
   */
  showToast(content: string, options: ToastOptions = {}): void {
    presentToast(content, options);
  }

  /**
   * Shows a notice above Discord's chat layer.
   *
   * @returns A callback that closes the notice; passing `true` closes it
   * immediately without transitioning out.
   */
  showNotice(
    content: string,
    options: NoticeOptions = {},
  ): ((immediate?: boolean) => void) | undefined {
    return presentNotice(content, options);
  }

  /**
   * Shows a confirmation modal with optional confirm and cancel callbacks.
   */
  showConfirmationModal(
    title: string,
    content: ModalContent | readonly ModalContent[],
    options: ConfirmationModalOptions = {},
  ): void {
    presentConfirmationModal(title, content, options);
  }

  /** Not implemented; see the module docblock. */
  showNotification(): void {
    unimplemented("showNotification");
  }

  /** Not implemented; see the module docblock. */
  createTooltip(): void {
    unimplemented("createTooltip");
  }

  /** Not implemented; see the module docblock. */
  showChangelogModal(): void {
    unimplemented("showChangelogModal");
  }

  /** Not implemented; see the module docblock. */
  showInviteModal(): void {
    unimplemented("showInviteModal");
  }

  /**
   * Not implemented: the Electron dialog bridge is not exposed to plugins.
   * Resolves as a cancelled dialog so callers take their graceful path.
   */
  openDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    unimplemented("openDialog");
    return Promise.resolve({ canceled: true, filePaths: [] });
  }

  /** Not implemented; see the module docblock. */
  buildSettingItem(): void {
    unimplemented("buildSettingItem");
  }

  /** Not implemented; see the module docblock. */
  buildSettingsPanel(): void {
    unimplemented("buildSettingsPanel");
  }

  /** Not implemented; see the module docblock. */
  openFloatingWindow(): void {
    unimplemented("openFloatingWindow");
  }
}

Object.freeze(UI);
Object.freeze(UI.prototype);
