/**
 * `BdApi.DOM` — BetterDiscord's DOM surface. A port of
 * src/betterdiscord/api/dom.ts (Apache-2.0, see THIRD_PARTY.md): the shared
 * `BaseDOM` operations plus style injection, with `BoundDOM` pre-scoping
 * the style id to the plugin name (so a bound `addStyle(css)` needs no id).
 */

import {
  DOMManager,
  type CreateElementOptions,
  type DeepChildren,
  type ParseHTMLResult,
} from "../modules/dommanager";

interface AnimateOptions {
  /** Optional function calculating progress from the time fraction. Linear by default. */
  timing?: (timeFraction: number) => number;
}

class BaseDOM {
  /** The current width of the user's screen. */
  get screenWidth(): number {
    return DOMManager.screenWidth;
  }

  /** The current height of the user's screen. */
  get screenHeight(): number {
    return DOMManager.screenHeight;
  }

  /**
   * Adds a listener for when the node is removed from the document body.
   *
   * @param node Node to be observed.
   * @param callback Function to run when removed.
   * @returns A function that cancels the observer.
   */
  onRemoved(node: HTMLElement, callback: () => void): () => void {
    return DOMManager.onRemoved(node, callback);
  }

  /**
   * Adds a listener for when a node matching a selector is added to the
   * document body. The listener is automatically removed upon firing.
   *
   * @param selector A CSS selector for the node to wait for.
   * @param callback Function to be performed on the matching element.
   * @returns A cancel function when still waiting; `undefined` when the
   *   node was already present and the callback ran immediately.
   */
  onAdded(selector: string, callback: (element: Element) => void): (() => void) | undefined {
    return DOMManager.onAdded(selector, callback);
  }

  /**
   * Utility to help smoothly animate using JavaScript.
   *
   * @param update Render function indicating the style should be updated.
   * @param duration Duration in ms to animate for.
   * @param options Options to customize the animation.
   * @returns A function that cancels the animation.
   */
  animate(
    update: (progress: number) => void,
    duration: number,
    options: AnimateOptions = {},
  ): () => void {
    return DOMManager.animate({ update, duration, timing: options.timing });
  }

  /**
   * Utility to make creating DOM elements easier. Acts similarly to
   * `React.createElement`.
   *
   * @param tag HTML tag name to create.
   * @param options Options object to customize the element.
   * @param children Child nodes to add (nesting is flattened).
   */
  createElement<T extends keyof HTMLElementTagNameMap>(
    tag: T,
    options: Partial<HTMLElementTagNameMap[T]> = {},
    ...children: DeepChildren[]
  ): HTMLElementTagNameMap[T] {
    // A per-tag Partial can't be proven assignable to the manager's
    // all-tags Partial under exactOptionalPropertyTypes; same runtime shape.
    const castOptions = options as CreateElementOptions;
    return DOMManager.createElement(tag, castOptions, ...children) as HTMLElementTagNameMap[T];
  }

  /**
   * Parses a string of HTML. With `fragment` (default false), the raw
   * DocumentFragment is returned; otherwise multiple top-level nodes come
   * back as a node list and a single node on its own.
   */
  parseHTML(html: string, fragment = false): ParseHTMLResult {
    return DOMManager.parseHTML(html, fragment);
  }
}

/**
 * `DOM` is a simple utility class for DOM manipulation. An instance is
 * available on {@link BdApi}.
 */
export class DOM extends BaseDOM {
  /**
   * Adds a `<style>` to the document with the given ID.
   *
   * @param id ID to use for the style element.
   * @param css CSS to apply to the document.
   */
  addStyle(id: string, css: string): void {
    if (!css) {
      throw new Error("No css provided");
    }

    DOMManager.injectStyle(id, css);
  }

  /**
   * Removes a `<style>` from the document corresponding to the given ID.
   *
   * @param id ID used for the style element.
   */
  removeStyle(id: string): void {
    if (!id) throw new Error("No id provided");

    DOMManager.removeStyle(id);
  }
}

/**
 * `BoundDOM` is a simple utility class for DOM manipulation, with plugin
 * scoping automatically supplied. An instance is available on instances of
 * {@link BdApi}: a one-argument `addStyle(css)` and an argument-less
 * `removeStyle()` use the plugin name as the style id.
 */
export class BoundDOM extends BaseDOM {
  readonly #callerName: string;

  constructor(callerName: string) {
    super();
    this.#callerName = callerName;
  }

  /**
   * Adds a `<style>` to the document. Called with only CSS, the plugin name
   * is used as the style id.
   *
   * @param idOrCss ID to use for the style element, or the CSS itself when bound.
   * @param css CSS to apply to the document.
   */
  addStyle(idOrCss: string, css?: string): void {
    let id = idOrCss;
    if (!css) {
      if (this.#callerName) {
        css = idOrCss;
        id = this.#callerName;
      } else {
        throw new Error("No css provided");
      }
    }

    DOMManager.injectStyle(id, css);
  }

  /**
   * Removes a `<style>` from the document; without an id, the plugin name
   * is used.
   *
   * @param id ID used for the style element.
   */
  removeStyle(id?: string): void {
    id ??= this.#callerName;
    if (!id) throw new Error("No id provided");

    DOMManager.removeStyle(id);
  }
}

Object.freeze(DOM);
Object.freeze(DOM.prototype);
