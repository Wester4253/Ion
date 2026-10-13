/**
 * Type declarations for `@uwu/shelter-ui`.
 *
 * The published package points `types` at `dist/index.d.ts`, and the
 * tarball does not contain that file — it ships `dist/index.jsx` (JSX
 * left for the consumer's bundler) and its sources. Without a declaration
 * the import would be an implicit `any`, which under `strict` is an error,
 * and a *silent* `any` is worse: this surface is what every adapter call
 * is type-checked against.
 *
 * So the export list is declared here, transcribed from the library's own
 * source for the version in `package.json` (`0.0.6`), with one deliberate
 * narrowing: components take open props, because upstream spreads whatever
 * it is given onto DOM nodes and its own prop types are built from Solid's
 * `NativeExtendingComponent` wrapper. The enum-like objects keep their
 * real keys — that is what makes `ButtonSizes.MEDIUM` a checked access
 * instead of an index-signature one, which `noPropertyAccessFromIndex`
 * would otherwise reject.
 *
 * A unit test (`api/ui.test.ts`) reads the compiled package's export block
 * and fails if this list and the package ever disagree, so drift cannot go
 * unnoticed.
 */

declare module "@uwu/shelter-ui" {
  import type { Component, JSX } from "solid-js";

  /** Open props: upstream components spread the unknown ones onto the DOM. */
  type Props = Record<string, unknown>;

  /** `[width, height, class]`, upstream's `ButtonSize`. */
  type ButtonSize = readonly [string, string, string];

  export interface ToastOptions {
    readonly title?: string;
    readonly content?: string;
    readonly color?: string;
    readonly onClick?: () => void;
    readonly class?: string;
    readonly duration?: number;
  }

  export interface ConfirmationOptions {
    readonly body: Component;
    readonly header: Component;
    readonly confirmText?: string;
    readonly cancelText?: string;
    readonly type?: "neutral" | "danger" | "confirm";
    readonly size?: string;
  }

  export const Button: Component<Props>;
  export const ButtonLooks: {
    readonly FILLED: string;
    readonly INVERTED: string;
    readonly OUTLINED: string;
    readonly LINK: string;
  };
  export const ButtonColors: {
    readonly PRIMARY: string;
    readonly SECONDARY: string;
    readonly CRITICAL_PRIMARY: string;
    readonly CRITICAL_SECONDARY: string;
    readonly ACTIVE: string;
    readonly OVERLAY_PRIMARY: string;
    readonly OVERLAY_SECONDARY: string;
    readonly BRAND: string;
    readonly RED: string;
    readonly GREEN: string;
    readonly LINK: string;
    readonly WHITE: string;
    readonly TRANSPARENT: string;
    readonly BLACK: string;
  };
  export const ButtonSizes: {
    readonly NONE: ButtonSize;
    readonly TINY: ButtonSize;
    readonly SMALL: ButtonSize;
    readonly MEDIUM: ButtonSize;
    readonly LARGE: ButtonSize;
    readonly XLARGE: ButtonSize;
    readonly MIN: ButtonSize;
    readonly MAX: ButtonSize;
    readonly ICON: ButtonSize;
  };

  export const Checkbox: Component<Props>;
  export const CheckboxItem: Component<Props>;
  export const Divider: Component<Props>;
  export const ErrorBoundary: Component<Props>;
  export const Header: Component<Props>;
  export const HeaderTags: {
    readonly HeadingXXL: string;
    readonly HeadingXL: string;
    readonly HeadingLG: string;
    readonly HeadingMD: string;
    readonly HeadingSM: string;
    readonly H1: string;
    readonly H2: string;
    readonly H3: string;
    readonly H4: string;
    readonly H5: string;
    readonly EYEBROW: string;
  };
  export const HeaderWeights: {
    readonly normal: string;
    readonly medium: string;
    readonly semibold: string;
    readonly bold: string;
    readonly extrabold: string;
  };
  export const LinkButton: Component<Props>;
  export const ModalBody: Component<Props>;
  export const ModalConfirmFooter: Component<Props>;
  export const ModalFooter: Component<Props>;
  export const ModalHeader: Component<Props>;
  export const ModalRoot: Component<Props>;
  export const ModalSizes: {
    readonly SMALL: string;
    readonly MEDIUM: string;
    readonly LARGE: string;
    readonly DYNAMIC: string;
  };
  export const ReactiveRoot: Component<Props>;
  export const Slider: Component<Props>;
  export const Space: Component<Props>;
  export const Switch: Component<Props>;
  export const SwitchItem: Component<Props>;
  export const Text: Component<Props>;
  export const TextArea: Component<Props>;
  export const TextBox: Component<Props>;
  export const TextTags: {
    readonly textXXS: string;
    readonly textXS: string;
    readonly textSM: string;
    readonly textMD: string;
    readonly textLG: string;
    readonly messagePreview: string;
    readonly channelTitle: string;
    readonly displaySM: string;
    readonly displayMD: string;
    readonly displayLG: string;
  };
  export const TextWeights: {
    readonly normal: string;
    readonly medium: string;
    readonly semibold: string;
    readonly bold: string;
    readonly extrabold: string;
  };

  export const ChevronIcon: Component<Props>;
  export const DevIcon: Component<Props>;
  export const IconAdd: Component<Props>;
  export const IconBin: Component<Props>;
  export const IconClose: Component<Props>;
  export const IconCog: Component<Props>;
  export const IconEdit: Component<Props>;
  export const IconInfo: Component<Props>;
  export const IconUpdate: Component<Props>;
  export const IconUpload: Component<Props>;
  export const LocalIcon: Component<Props>;
  export const SyncIcon: Component<Props>;

  export const InternalStyles: Component<Props>;
  export const ToastColors: {
    readonly INFO: string;
    readonly SUCCESS: string;
    readonly WARNING: string;
    readonly CRITICAL: string;
  };

  /** Upstream's four startup helpers; stripped from `shelter.ui`. */
  export function cleanupCss(): void;
  export function initToasts(mountPoint: HTMLElement): () => void;
  export function injectInternalStyles(): void;

  export function injectCss(css: string): (replacement?: string) => void;
  export function genId(): string;
  export function niceScrollbarsClass(): string;
  export function getRoot(element: Node | null): Node | null;

  /**
   * Upstream returns a callable that re-injects itself after its helper
   * component leaves the DOM, plus the `cancel` that stops doing so.
   */
  export interface PersistenceHelper<T> {
    (): T;
    cancel(): void;
  }

  export function createPersistenceHelper<T>(
    func: (helper: () => HTMLElement) => T,
  ): PersistenceHelper<T>;
  export function focusring(element: Element, radius: () => number): void;
  export function tooltip(
    element: HTMLElement,
    props: () => JSX.Element | [boolean, JSX.Element],
  ): void;

  export function openModal(render: Component<{ close(): void }>): () => void;
  export function openConfirmationModal(options: ConfirmationOptions): Promise<void>;
  export function showToast(options?: ToastOptions): () => void;
}
