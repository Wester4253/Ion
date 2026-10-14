/**
 * React node patching — a behavioral port of BetterDiscord's
 * src/betterdiscord/modules/nodepatcher.ts (Apache-2.0, see
 * THIRD_PARTY.md). Wraps a component type (class, function, memo,
 * forwardRef, or lazy) so the callback sees every rendered node, without
 * touching Discord's modules: the wrapper is a new component identity the
 * patcher hands back to the caller.
 *
 * One instance patches one thing by design (upstream's own note): create a
 * new instance per patch. `destroy()` stops every wrapper the instance made
 * from calling back, which is how ContextMenu unwinds on shutdown.
 */

import { loadedReact, type BdComponentClass, type BdReactElement } from "./discord-modules";
import { getType } from "../utils/react";

export type NodePatchCallback = (
  props: Record<string, unknown>,
  result: unknown,
  instance?: Record<string, unknown>,
) => unknown;

interface FunctionComponentType {
  (props: Record<string, unknown>): unknown;
  prototype?: { isReactComponent?: unknown };
  displayName?: string;
  defaultProps?: unknown;
  propTypes?: unknown;
  $$typeof?: symbol;
  type?: unknown;
  render?: unknown;
  _payload?: { _status?: number; _result?: unknown };
  _init?: (payload: unknown) => unknown;
  compare?: unknown;
  [key: symbol]: unknown;
}

export class NodePatcher {
  readonly #id = Symbol("BetterDiscord.NodePatcher");
  readonly #cache = new WeakMap<object, FunctionComponentType>();
  #destroyed = false;

  /** Wraps `node.type` in place so `callback` sees each rendered node. */
  patch(node: BdReactElement, callback: NodePatchCallback): void {
    if (this.#destroyed) return;
    const React = loadedReact();
    if (!React) return;

    const isDestroyed = (): boolean => this.#destroyed;
    const rawType: unknown = node.type;
    if (rawType === null || typeof rawType === "string") return;
    if (typeof rawType !== "object" && typeof rawType !== "function") return;

    const type = rawType as FunctionComponentType;

    const cached = this.#cache.get(type);
    if (cached) {
      node.type = cached;
      return;
    }

    const own = type[this.#id] as FunctionComponentType | undefined;
    if (own) {
      node.type = own;
      return;
    }

    if (type.prototype?.isReactComponent) {
      const Base = type as unknown as BdComponentClass;
      class ComponentType extends Base {
        override render(): unknown {
          const res = super.render();
          if (isDestroyed()) return res;
          const ret = callback(this.props, res, this as unknown as Record<string, unknown>);
          if (ret === undefined) return res;
          return ret;
        }
      }

      const wrapped = ComponentType as unknown as FunctionComponentType;
      this.#cache.set(type, wrapped);
      this.#cache.set(wrapped, wrapped);
      wrapped[this.#id] = wrapped;
      node.type = wrapped;
      return;
    }

    const resolved = getType(type);
    if (typeof resolved !== "function") {
      // Not a renderable type (a symbol or plain object); leave it be.
      node.type = type;
      return;
    }
    const FC = resolved as (props: Record<string, unknown>) => unknown;

    function FunctionType(props: Record<string, unknown>): unknown {
      const res = FC(props);

      if (res instanceof Promise) {
        // `instanceof Promise` instantiates the type argument as `any`;
        // pin it to `unknown` so the rest of this function stays typed.
        const pending: Promise<unknown> = res;
        return pending.then((awaited) => {
          if (isDestroyed()) return awaited;
          const ret = callback(props, awaited);
          if (ret === undefined) return awaited;
          return ret;
        });
      }

      if (isDestroyed()) return res;
      const ret = callback(props, res);
      if (ret === undefined) return res;
      return ret;
    }

    let newType: FunctionComponentType = FunctionType as FunctionComponentType;
    const asObject = type as { type?: unknown; render?: unknown; compare?: unknown };

    if (asObject.type) {
      const inner = asObject.type as { render?: unknown } | null;
      newType = React.memo(
        inner?.render ? React.forwardRef(FunctionType) : FunctionType,
        asObject.compare,
      ) as FunctionComponentType;
    } else if (asObject.render) {
      newType = React.forwardRef(FunctionType) as FunctionComponentType;
    } else if (type._payload) {
      newType = React.lazy(() => {
        const payload = type._payload;
        const init = type._init;
        if (!payload || !init) return Promise.resolve({ default: FunctionType });

        const out = init(payload);

        const handle = (component: unknown): { default: unknown } => {
          const innerNode = { type: component } as BdReactElement;
          this.patch(innerNode, callback);
          return { default: innerNode.type };
        };

        if (out instanceof Promise) {
          return out.catch((error: unknown) => handle((error as { default?: unknown }).default));
        }
        return Promise.resolve(handle(out));
      }) as FunctionComponentType;
    }

    for (const propName of ["defaultProps", "displayName", "propTypes"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(type, propName);
      if (descriptor) Object.defineProperty(newType, propName, descriptor);
    }

    this.#cache.set(type, newType);
    this.#cache.set(newType, newType);
    newType[this.#id] = newType;
    node.type = newType;
  }

  /** Stops every wrapper this instance made from calling back. */
  destroy(): void {
    this.#destroyed = true;
  }
}
