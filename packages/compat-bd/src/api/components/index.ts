/**
 * `BdApi.Components` — upstream's utility of commonly used React
 * components, ported from `src/betterdiscord/api/components.ts`
 * (Apache-2.0 — see THIRD_PARTY.md).
 *
 * Two deliberate differences from upstream, both forced by timing:
 * - upstream resolves Discord's `Tooltip` and the accessibility context
 *   at load time; here they resolve on first access, memoized — see
 *   lookups.ts.
 * - every member is a memoized getter instead of an instance field: the
 *   adapter bundle evaluates before Discord's React exists, so the
 *   components can only be built once `getReact()` resolves. Before that
 *   the getters return `undefined`; once Discord has loaded they are the
 *   real components (identical shapes to upstream's).
 *
 * Not yet ported (recorded in docs/compat-bd.md): `SettingGroup` and
 * `Modal`, which depend on BetterDiscord's own settings store and modal
 * stack rather than being plain React components.
 */

import { boundLoggerFor } from "../logger";
import { createButton, createDivider, createFlex, createSpinner, createText } from "./base";
import { createErrorBoundary } from "./feedback";
import { tooltipComponent } from "./lookups";
import { componentsReact, type ComponentsReact } from "./runtime";
import {
  createCheckbox,
  createColorInput,
  createDropdown,
  createKeybind,
  createNumber,
  createRadio,
  createSearch,
  createSettingItem,
  createSlider,
  createSwitch,
  createTextbox,
} from "./settings";
import { COMPONENT_CSS } from "./styles";

/** BD's version banner shown by plugin changelog footers. */
const BD_VERSION = "1.14.2";

let stylesInjected = false;

/** Injects upstream's component stylesheet once, on first access. */
function ensureComponentStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.dataset["ionBdComponents"] = BD_VERSION;
  style.textContent = COMPONENT_CSS;
  // The adapter evaluates at document-start, before <head> exists.
  (document.querySelector("head") ?? document.documentElement).append(style);
}

export class Components {
  readonly #slots = new Map<string, unknown>();

  /** Resolves one member once React exists; memoizes the result. */
  #lazy<T>(slot: string, build: (react: ComponentsReact) => T): T | undefined {
    const react = componentsReact();
    if (!react) return undefined;
    ensureComponentStyles();
    let value = this.#slots.get(slot);
    if (value === undefined) {
      value = build(react);
      this.#slots.set(slot, value);
    }
    return value as T;
  }

  /** Discord's Tooltip component (the `renderTooltip` HOC), when found. */
  get Tooltip(): unknown {
    return tooltipComponent();
  }

  /** BD's typography element. */
  get Text(): ReturnType<typeof createText> | undefined {
    return this.#lazy("text", (react) => createText(react));
  }

  /** BD's flex container. */
  get Flex(): ReturnType<typeof createFlex> | undefined {
    return this.#lazy("flex", (react) => createFlex(react));
  }

  /** BD's button. */
  get Button(): ReturnType<typeof createButton> | undefined {
    return this.#lazy("button", (react) => createButton(react));
  }

  /** BD's spinner. */
  get Spinner(): ReturnType<typeof createSpinner> | undefined {
    return this.#lazy("spinner", (react) => createSpinner(react));
  }

  /** BD's horizontal divider. */
  get Divider(): ReturnType<typeof createDivider> | undefined {
    return this.#lazy("divider", (react) => createDivider(react));
  }

  /** BD's React error boundary (render-frozen per the addon policy). */
  get ErrorBoundary(): ReturnType<typeof createErrorBoundary> | undefined {
    return this.#lazy("errorBoundary", (react) =>
      createErrorBoundary(react, boundLoggerFor("ErrorBoundary")),
    );
  }

  /** BD's settings row. */
  get SettingItem(): ReturnType<typeof createSettingItem> | undefined {
    return this.#lazy("settingItem", (react) => createSettingItem(react));
  }

  /** BD's switch input. */
  get Switch(): ReturnType<typeof createSwitch> | undefined {
    return this.#lazy("switch", (react) => createSwitch(react));
  }

  /** BD's text input. */
  get TextInput(): ReturnType<typeof createTextbox> | undefined {
    return this.#lazy("textbox", (react) => createTextbox(react));
  }

  /** BD's checkbox input. */
  get Checkbox(): ReturnType<typeof createCheckbox> | undefined {
    return this.#lazy("checkbox", (react) => createCheckbox(react));
  }

  /** BD's number stepper. */
  get NumberInput(): ReturnType<typeof createNumber> | undefined {
    return this.#lazy("number", (react) => createNumber(react));
  }

  /** BD's radio group. */
  get Radio(): ReturnType<typeof createRadio> | undefined {
    return this.#lazy("radio", (react) => createRadio(react));
  }

  /** BD's search input. */
  get Search(): ReturnType<typeof createSearch> | undefined {
    return this.#lazy("search", (react) => createSearch(react));
  }

  /** BD's slider input. */
  get Slider(): ReturnType<typeof createSlider> | undefined {
    return this.#lazy("slider", (react) => createSlider(react));
  }

  /** BD's keybind recorder. */
  get Keybind(): ReturnType<typeof createKeybind> | undefined {
    return this.#lazy("keybind", (react) => createKeybind(react));
  }

  /** BD's dropdown select. */
  get Dropdown(): ReturnType<typeof createDropdown> | undefined {
    return this.#lazy("dropdown", (react) => createDropdown(react));
  }

  /** BD's color input with swatches. */
  get ColorPicker(): ReturnType<typeof createColorInput> | undefined {
    return this.#lazy("colorPicker", (react) => createColorInput(react));
  }
}

// Upstream freezes the class and its prototype against plugin tampering.
Object.freeze(Components);
Object.freeze(Components.prototype);
