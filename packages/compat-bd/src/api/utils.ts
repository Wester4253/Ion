/**
 * `BdApi.Utils` — BetterDiscord's utility surface. A port of
 * src/betterdiscord/api/utils.ts (Apache-2.0, see THIRD_PARTY.md): the same
 * shared implementations upstream re-exports (tree walking, deep extend,
 * debounce, clsx, semver comparison, mapObject, Store, cache), the DOM-
 * backed `escapeHTML`, and the chunk-loading helpers `forceLoad`/
 * `loadEntry`.
 *
 * Upstream builds these as per-instance fields on a class; they are all
 * stateless, so this port exposes the same surface as one frozen object —
 * identical for callers, without per-instance copies.
 */

import { clsx } from "../common/clsx";
import { comparator } from "../common/semver";
import { Store } from "../common/store";
import { cache, debounce, extend, findInTree, getNestedProp } from "../common/utils";
import { forceLoad, loadEntry } from "../webpack/lazy";
import { mapObject } from "./webpack/mapObject";

/** Takes a string of HTML and escapes it using the browser's own mechanism. */
function escapeHTML(html: string): string {
  const textNode = document.createTextNode("");
  const spanElement = document.createElement("span");
  spanElement.append(textNode);
  textNode.nodeValue = html;
  return spanElement.innerHTML;
}

export const Utils = Object.freeze({
  /** DFS for a value, subobject, or array matching a filter (or a key). */
  findInTree,

  /** Deep extends an object with a set of other objects. */
  extend,

  /** Debounces a function: trailing edge, `delay` ms after the last call. */
  debounce,

  /** Escapes a string of HTML through the browser's own escaping. */
  escapeHTML,

  /** Builds a classname string from strings, arrays, and key maps (clsx). */
  className: clsx,

  /** Gets a nested value by `key.key2.key3` path, safely. */
  getNestedValue: getNestedProp,

  /** Compares two semantic versions: 0 equal, -1 left greater, 1 right. */
  semverCompare: comparator,

  /** Maps the properties of one object onto another based on filters. */
  mapObject,

  /** A class which can be listened to for changes. */
  Store,

  /** Memoizes a factory's result; `.proxy` defers it to first property access. */
  cache,

  /** Force-loads the chunks a module id references, then evaluates them. */
  forceLoad,

  /** Loads the lazy entry a function's source points at. */
  loadEntry,
});
