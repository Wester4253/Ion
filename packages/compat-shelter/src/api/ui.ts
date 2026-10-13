/**
 * `shelter.ui` — Shelter's component library.
 *
 * Two parts, and only one of them is here yet.
 *
 * `injectCss` and `genId` are reproduced directly (uwu/shelter is CC0-1.0,
 * see THIRD_PARTY.md) because they are pure page bookkeeping with no
 * rendering: a `<style>` appended to the body whose updater replaces or
 * removes it, and a DOM id. Every plugin that injects CSS uses the first.
 *
 * Everything else is a component from `@uwu/shelter-ui`, which is Solid JSX
 * that has to be *compiled* — reading it does nothing until a bundler turns
 * it into Solid runtime calls. Until that lands in this adapter, each of
 * those names is a placeholder that throws its own name and the reason when
 * a plugin touches it. Returning `undefined` instead would turn a known
 * gap into "X is not a function", which says nothing; a named error lands
 * on the plugin's own row of the scoreboard with the reason intact.
 *
 * The list below is `@uwu/shelter-ui`'s export list minus the members
 * upstream itself strips from `shelter.ui` (`cleanupCss`, `initToasts`,
 * `injectInternalStyles`, `InternalStyles`), plus the two bridges upstream
 * merges in from `src/bridges.tsx`.
 */

const NOT_COMPILED_YET = [
  "Button",
  "ButtonColors",
  "ButtonLooks",
  "ButtonSizes",
  "Checkbox",
  "CheckboxItem",
  "ChevronIcon",
  "DevIcon",
  "Divider",
  "ErrorBoundary",
  "Header",
  "HeaderTags",
  "HeaderWeights",
  "IconAdd",
  "IconBin",
  "IconClose",
  "IconCog",
  "IconEdit",
  "IconInfo",
  "IconUpdate",
  "IconUpload",
  "LinkButton",
  "LocalIcon",
  "ModalBody",
  "ModalConfirmFooter",
  "ModalFooter",
  "ModalHeader",
  "ModalRoot",
  "ModalSizes",
  "ReactiveRoot",
  "ReactInSolidBridge",
  "Slider",
  "Space",
  "Switch",
  "SwitchItem",
  "SyncIcon",
  "Text",
  "TextArea",
  "TextBox",
  "TextTags",
  "TextWeights",
  "ToastColors",
  "createPersistenceHelper",
  "focusring",
  "getRoot",
  "niceScrollbarsClass",
  "openConfirmationModal",
  "openModal",
  "renderSolidInReact",
  "showToast",
  "tooltip",
] as const;

/** Property reads a placeholder must answer instead of throwing. */
const PASSTHROUGH = new Set<PropertyKey>(["name", "length", "prototype", "constructor"]);

function notCompiled(member: string): never {
  throw new Error(
    `shelter.ui.${member} is not available: @uwu/shelter-ui is not compiled into ` +
      `Ion's Shelter adapter yet; see docs/status.md`,
  );
}

/**
 * A placeholder that fails by name however it is used: called as a
 * component (`SwitchItem(props)`) or indexed as an enum (`ButtonColors.
 * PRIMARY`). Only the reflection properties the runtime itself reads are
 * answered directly, so an error message can still name the value.
 */
function placeholder(member: string): object {
  return new Proxy(() => undefined, {
    apply: () => notCompiled(member),
    get: (target, property) => {
      if (typeof property === "symbol" || PASSTHROUGH.has(property)) {
        const reflected: unknown = Reflect.get(target, property);
        return reflected;
      }
      return notCompiled(member);
    },
  });
}

/**
 * `shelter.ui.injectCss`: appends a `<style>` to the body and returns an
 * updater — call it with no argument to remove the sheet, or with CSS to
 * replace its contents.
 */
export function injectCss(css: string): (replacement?: string) => void {
  const element = document.createElement("style");
  element.textContent = css;
  document.body.append(element);

  return (replacement?: string): void => {
    if (replacement === undefined) element.remove();
    else element.textContent = replacement;
  };
}

/** `shelter.ui.genId`: a DOM id prefixed so it cannot collide with Discord's. */
export function genId(): string {
  return `shltr-ui-${Math.random().toString(36).slice(2)}`;
}

/** Renders a modal's body; `close` dismisses it, as upstream passes in. */
export type ModalRender = (props: { readonly close: () => void }) => unknown;

/**
 * The `shelter.ui` surface. `injectCss` and `genId` are real; every other
 * member is a placeholder that throws its own name — see the file header.
 */
export interface UiSurface {
  injectCss: typeof injectCss;
  genId: typeof genId;
  /** Throws until `@uwu/shelter-ui` is compiled in. */
  openModal: (render: ModalRender) => unknown;
  [member: string]: unknown;
}

/**
 * Builds the `shelter.ui` surface. Replaces this file wholesale once
 * `@uwu/shelter-ui` is compiled in — nothing else in the adapter imports
 * from here.
 */
export function createUiSurface(): UiSurface {
  const surface: Record<string, unknown> = { injectCss, genId };
  for (const member of NOT_COMPILED_YET) {
    if (member in surface) continue;
    surface[member] = placeholder(member);
  }
  return surface as UiSurface;
}
