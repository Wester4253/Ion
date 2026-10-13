/**
 * `BdApi.ReactUtils` — React internals for plugins. A port of
 * src/betterdiscord/api/reactutils.ts (Apache-2.0, see THIRD_PARTY.md).
 *
 * The helpers live in utils/react.ts and resolve Discord's React lazily;
 * see that module's docblock for the timing note.
 */

import type { BdComponentClass } from "../modules/discord-modules";
import { NodePatcher } from "../modules/nodepatcher";
import {
  getInternalInstance,
  getOwnerInstance,
  getType,
  wrapElement,
  wrapInHooks,
  type BdFiber,
  type PatchedReactHooks,
} from "../utils/react";
import type { GetOwnerInstanceOptions } from "../utils/react";

export class ReactUtils {
  /**
   * The legacy React 16 root handle. Kept because plugins read it; modern
   * Discord does not expose `_reactRootContainer`, so it reads as undefined.
   *
   * @deprecated Upstream deprecated this too; use the fiber helpers.
   */
  get rootInstance(): unknown {
    // Required-property shape keeps this assertion honest (an all-optional
    // target would make the cast redundant to the linter).
    const appMount = document.getElementById("app-mount") as {
      _reactRootContainer: { _internalRoot?: { current?: unknown } } | undefined;
    } | null;
    return appMount?._reactRootContainer?._internalRoot?.current;
  }

  /** Gets the internal React fiber data of a node, if any. */
  getInternalInstance(node: Element): BdFiber | null {
    return getInternalInstance(node);
  }

  /**
   * Finds the nearest class-component "owner" instance above a node.
   */
  getOwnerInstance(
    node: Element | undefined,
    options?: GetOwnerInstanceOptions,
  ): Record<string, unknown> | null {
    return getOwnerInstance(node, options);
  }

  /** An unrendered React component that mounts raw DOM elements. */
  wrapElement(element: Element | Element[]): BdComponentClass {
    return wrapElement(element);
  }

  /** Wraps a functional component to render outside React's lifecycle. */
  wrapInHooks(
    functionComponent: unknown,
    customPatches: Partial<PatchedReactHooks> = {},
  ): (props: Record<string, unknown>) => unknown {
    return wrapInHooks(functionComponent, customPatches);
  }

  /** Resolves a component type through memo/forwardRef/lazy wrappers. */
  getType(elementType: unknown): unknown {
    return getType(elementType);
  }

  /** Creates a NodePatcher instance used to patch rendered React trees. */
  createNodePatcher(): NodePatcher {
    return new NodePatcher();
  }
}

Object.freeze(ReactUtils);
Object.freeze(ReactUtils.prototype);
