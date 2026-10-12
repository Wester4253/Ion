/**
 * BetterDiscord's DOM utilities — a port of
 * src/betterdiscord/modules/dommanager.ts (Apache-2.0, see THIRD_PARTY.md),
 * keeping the pieces `BdApi.DOM` exposes: element creation, HTML parsing,
 * style injection/removal, node add/remove watchers, and JS animation.
 *
 * Deviations, recorded in THIRD_PARTY.md:
 * - Ion injects styles into `document.head` instead of BetterDiscord's
 *   `bd-head`/`bd-styles` element tree, which is not created here. Ids are
 *   still CSS-escaped and resolved with `getElementById`, so
 *   addStyle/removeStyle semantics (including in-place updates of an
 *   existing id) are unchanged.
 * - The parts only BD's own internals reach — scripts, themes, custom CSS,
 *   and the `bd-*` element getters — are omitted rather than left dead;
 *   Ion's theme engine handles themes.
 */

import { Logger } from "../common/logger";

type DeepArray<T> = T | DeepArray<T>[];

interface AnimationOptions {
  timing?: ((fraction: number) => number) | undefined;
  update: (progress: number) => void;
  duration: number;
}

// The tag map's `target` (from <area>/<a>-style elements) carries lib.dom's
// @deprecated tag; Omit strips it so this deliberately-kept option is clean.
type CreateElementOptions = Omit<
  Partial<HTMLElementTagNameMap[keyof HTMLElementTagNameMap]>,
  "target"
> & {
  /** BD-internal leftover: appends the element to this target (deprecated upstream, kept for compatibility). */
  target?: string | Element;
};

export type { CreateElementOptions };

/** Result of {@link DOMManager.parseHTML}: a fragment, node list, or node. */
export type ParseHTMLResult = DocumentFragment | NodeListOf<ChildNode> | ChildNode | undefined;

/** Child input for {@link DOMManager.createElement}: deeply nested, null-safe. */
export type DeepChildren = DeepArray<Node | string | null | undefined>;

function escapeID(id: string): string {
  return CSS.escape(id);
}

/** Flattens deeply nested children, skipping null/undefined (upstream's `.flat(Infinity)`). */
function flattenChildren(children: readonly DeepChildren[]): (Node | string)[] {
  const flat: (Node | string)[] = [];
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (Array.isArray(child)) flat.push(...flattenChildren(child));
    else flat.push(child);
  }
  return flat;
}

// BetterDiscord keeps this stateful surface on a class of statics; mirroring
// that shape keeps this file directly diffable against upstream's source.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DOMManager {
  /** Document/window width. */
  static get screenWidth(): number {
    return Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
  }

  /** Document/window height. */
  static get screenHeight(): number {
    return Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
  }

  /**
   * Utility to make creating DOM elements easier, with backward
   * compatibility with the previous createElement implementation.
   */
  static createElement(
    type: string,
    options: CreateElementOptions = {},
    ...children: DeepChildren[]
  ): HTMLElement {
    const element = document.createElement(type);

    Object.assign(element, options);

    element.append(...flattenChildren(children));

    if (options.target) {
      Logger.warn(
        "DOM.createElement",
        'Usage of the "target" option has been deprecated and will be removed in the next version.',
      );
      const target =
        typeof options.target === "string"
          ? document.querySelector(options.target)
          : options.target;
      target?.append(element);
    }

    return element;
  }

  /**
   * Parses a string of HTML. With `fragment`, the raw DocumentFragment is
   * returned; otherwise multiple top-level nodes come back as a node list
   * and a single node on its own.
   */
  static parseHTML(html: string, fragment = false): ParseHTMLResult {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    const node = template.content.cloneNode(true) as DocumentFragment;
    if (fragment) return node;
    return node.childNodes.length > 1 ? node.childNodes : node.childNodes[0];
  }

  /** Removes the style element with the given id, if present. */
  static removeStyle(id: string): void {
    document.getElementById(escapeID(id))?.remove();
  }

  /** Injects (or updates) a `<style id=...>` in the document head. */
  static injectStyle(id: string, css: string): void {
    const escaped = escapeID(id);
    const style =
      document.getElementById(escaped) ?? DOMManager.createElement("style", { id: escaped });
    style.textContent = css;
    document.head.append(style);
  }

  /** Utility to help smoothly animate using JavaScript; returns a cancel function. */
  static animate({
    timing = (fraction) => fraction,
    update,
    duration,
  }: AnimationOptions): () => void {
    const start = performance.now();

    let id = requestAnimationFrame(function animate(time) {
      // timeFraction goes from 0 to 1
      let timeFraction = (time - start) / duration;
      if (timeFraction > 1) timeFraction = 1;

      // calculate the current animation state
      const progress = timing(timeFraction);

      update(progress); // draw it

      if (timeFraction < 1) id = requestAnimationFrame(animate);
    });

    return () => {
      cancelAnimationFrame(id);
    };
  }

  /**
   * Adds a listener for when a node matching a selector is added to the
   * document body. The listener is automatically removed upon firing; the
   * callback is given the matching element. Returns a cancel function when
   * waiting (immediate matches return `undefined`).
   */
  static onAdded(selector: string, callback: (element: Element) => void): (() => void) | undefined {
    const existing = document.body.querySelector(selector);
    if (existing) {
      callback(existing);
      return undefined;
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue; // ignore non-elements
          const element = node as Element;
          const directMatch = element.matches(selector) ? element : null;
          const match = directMatch ?? element.querySelector(selector);
          if (match) {
            observer.disconnect();
            callback(match);
            return;
          }
        }
      }
    });

    observer.observe(document.body, { subtree: true, childList: true });

    return () => {
      observer.disconnect();
    };
  }

  /**
   * Adds a listener for when a node is removed from the document body.
   * Returns a cancel function for the observer.
   */
  static onRemoved(node: Node, callback: () => void): () => void {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const nodes = Array.from(mutation.removedNodes);
        const directMatch = nodes.includes(node);
        const parentMatch = nodes.some((parent) => parent.contains(node));
        if (directMatch || parentMatch) {
          observer.disconnect();
          callback();
          return;
        }
      }
    });

    observer.observe(document.body, { subtree: true, childList: true });
    return () => {
      observer.disconnect();
    };
  }
}
