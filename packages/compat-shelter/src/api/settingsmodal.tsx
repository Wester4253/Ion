/**
 * The modal a plugin's settings open through.
 *
 * Both shapes come from upstream's `src/plugins.tsx`, which builds the same
 * pieces around a plugin's own settings component: a `ModalRoot`, a
 * `ModalHeader` titled `Settings - <name>`, and a `ModalBody` holding the
 * component. `plugin.showSettings()` adds a footer with the Done button
 * that closes the dialog; `plugins.showSettingsFor(id)` has no footer — the
 * dialog's own dismiss does — and returns a promise that resolves when the
 * modal leaves the DOM, which is what upstream's `onCleanup(res)` does.
 *
 * The plugin's component is called with `{}` (upstream passes no props),
 * inside the modal's render, so it participates in Solid's tracking like
 * every other component in the tree.
 *
 * Kept in its own file because it is the adapter's Solid JSX: the rest of
 * the adapter is plain TypeScript, and a single `.tsx` next to it should
 * say why it exists.
 *
 * (uwu/shelter is CC0-1.0; see THIRD_PARTY.md.)
 */

import type { JSX } from "solid-js";
import { onCleanup } from "solid-js";

import {
  Button,
  ButtonColors,
  ButtonSizes,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalRoot,
} from "@uwu/shelter-ui";

import type { UiSurface } from "./ui";

/** A plugin's settings component, as the host hands it over. */
export type SettingsComponent = (props: Record<string, unknown>) => unknown;

/** Builds one settings dialog; `done` adds upstream's Done footer. */
function settingsDialog(
  pluginName: string,
  component: SettingsComponent | undefined,
  done: boolean,
  onClosed?: () => void,
): (props: { close(): void }) => JSX.Element {
  return (props) => {
    if (onClosed !== undefined) onCleanup(onClosed);
    return (
      <ModalRoot>
        <ModalHeader
          close={() => {
            props.close();
          }}
        >
          Settings - {pluginName}
        </ModalHeader>
        <ModalBody>{component?.({}) ?? null}</ModalBody>
        {done ? (
          <ModalFooter>
            <Button
              size={ButtonSizes.MEDIUM}
              color={ButtonColors.PRIMARY}
              onClick={() => {
                props.close();
              }}
            >
              Done
            </Button>
          </ModalFooter>
        ) : null}
      </ModalRoot>
    );
  };
}

/**
 * `shelter.plugin.showSettings()` — the dialog with the Done button.
 *
 * A plugin without a settings component still gets the modal with an empty
 * body, which is upstream's behaviour too: opening settings is the plugin's
 * own call, and an empty dialog is a truthful answer to it.
 */
export function openSettingsModal(
  openModal: UiSurface["openModal"],
  pluginName: string,
  component: SettingsComponent | undefined,
): void {
  openModal(settingsDialog(pluginName, component, true));
}

/**
 * `shelter.plugins.showSettingsFor(id)` — the footer-less dialog, resolving
 * once it closes. Throws when there is no settings component, as upstream
 * does, because a caller asking to show settings for a plugin that has none
 * is a bug it should see.
 */
export function openSettingsModalAndWait(
  openModal: UiSurface["openModal"],
  pluginName: string,
  component: SettingsComponent,
): Promise<void> {
  return new Promise((resolve) => {
    openModal(settingsDialog(pluginName, component, false, resolve));
  });
}
