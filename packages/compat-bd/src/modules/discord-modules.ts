/**
 * Discord's own modules, resolved lazily — the adapter's counterpart to
 * BetterDiscord's src/betterdiscord/modules/discordmodules.ts
 * (Apache-2.0, see THIRD_PARTY.md).
 *
 * Upstream resolves these synchronously at load because BetterDiscord's
 * bundle runs after Discord's webpack runtime exists. Ion's bundle runs
 * before any Discord script, so every module here resolves on first access
 * — retrying until the chunk that carries it has loaded — and is memoized
 * from then on. The values plugins receive are Discord's own module
 * objects, identical to BetterDiscord's; only the resolution timing
 * differs.
 */

import { discovery } from "../host";

/** The subset of React's shape compat-bd and BD plugins touch. */
export interface BdReactElement {
  type: unknown;
  props: Record<string, unknown>;
  key?: string | number | null;
}

/** A React component instance, structural (no @types/react dependency). */
export interface BdReactComponent {
  props: Record<string, unknown>;
  state: Record<string, unknown>;
  setState(state: Record<string, unknown>): void;
  render(): unknown;
}

/** A React class component constructor. */
export type BdComponentClass = new (props: Record<string, unknown>) => BdReactComponent;

/** Discord's React, as BetterDiscord exposes it on `BdApi.React`. */
export interface BdReact {
  readonly Component: BdComponentClass;
  readonly Fragment: unknown;
  createElement(type: unknown, props?: object | null, ...children: unknown[]): BdReactElement;
  cloneElement(
    element: BdReactElement,
    props?: object | null,
    ...children: unknown[]
  ): BdReactElement;
  isValidElement(value: unknown): boolean;
  createRef(): { current: unknown };
  memo(type: unknown, compare?: unknown): unknown;
  forwardRef(render: (props: Record<string, unknown>, ref: unknown) => unknown): unknown;
  lazy(factory: () => unknown): unknown;
  useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  useReducer<T>(
    reducer: (state: T, action: unknown) => T,
    initial: T,
  ): [state: T, dispatch: (action?: unknown) => void];
  useRef<T>(initial: T | null): { current: T | null };
  useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  /** Runs the effect (which may return a cleanup) out of band. */
  useInsertionEffect(effect: () => unknown, deps?: readonly unknown[]): void;
  /**
   * React's private dispatcher handle. `wrapInHooks` swaps this object's
   * hook table while a wrapped component renders outside the normal
   * lifecycle; the name is React's own (a version bump may rename it, in
   * which case the wrap falls back to calling the component directly).
   */
  readonly __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: {
    H?: Record<string, unknown>;
  };
}

/** Discord's react-dom, base (`createPortal`) merged with client (`createRoot`). */
export interface BdReactDom {
  createPortal?: (children: unknown, container: Element, key?: string) => unknown;
  createRoot?: (
    container: Element,
    options?: Record<string, unknown>,
  ) => {
    render(children: unknown): void;
    unmount(): void;
  };
  [key: string]: unknown;
}

/** Discord's Flux dispatcher, as BetterDiscord's ContextMenu relies on it. */
export interface BdDispatcher {
  dispatch(event: { type: string; [key: string]: unknown }): void;
  subscribe(type: string, listener: (event: unknown) => void): void;
  register(id: string, listener: (event: unknown) => void): unknown;
  /** Discord-internal interceptor hook; the ContextMenu API depends on it. */
  addInterceptor?(listener: (event: { type: string; [key: string]: unknown }) => void): string;
}

function hasKeys(...keys: string[]): (exports: unknown) => boolean {
  return (exports) => {
    if (exports === null || exports === undefined) return false;
    if (typeof exports !== "object" && typeof exports !== "function") return false;
    const candidate = exports as Record<string, unknown>;
    return keys.every((key) => key in candidate);
  };
}

/**
 * Resolves once and retries until found: the lookup runs on every access
 * until it produces a value, then the result is memoized for the session —
 * the lazy equivalent of upstream's load-time `getByKeys`.
 */
function deferred<T extends object>(lookup: () => T | undefined): () => T | undefined {
  let resolved: T | undefined;
  return () => {
    resolved ??= lookup();
    return resolved;
  };
}

/**
 * A stand-in for a Discord module that may not have loaded yet. Property
 * reads resolve the lookup on first use and forward to the real module, so
 * `const { createElement } = BdApi.React` works even when the plugin
 * evaluates before React's chunk arrives — upstream BD never hands out
 * undefined here, and neither does Ion. After 50 failed resolutions the
 * real error surfaces instead of another undefined.
 */
function lazyModule<T extends object>(
  lookup: () => T | undefined,
  label: string,
  isComplete: (value: T) => boolean = () => true,
): T {
  let resolved: T | undefined;
  const evaluate = (): T => {
    if (resolved === undefined || !isComplete(resolved)) resolved = lookup();
    if (resolved === undefined) {
      throw new Error(`[ion] ${label} is not loaded yet — Discord's chunk has not evaluated`);
    }
    return resolved;
  };
  return new Proxy({} as T, {
    get(_target, property, receiver) {
      // Proxy traps forward arbitrary module members; typing them is impossible.

      return Reflect.get(evaluate(), property, receiver);
    },
    has(_target, property) {
      return Reflect.has(evaluate(), property);
    },
    apply(_target, thisArg, args) {
      const value = evaluate();
      if (typeof value !== "function") throw new Error(`[ion] ${label} is not callable`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return Reflect.apply(value, thisArg, args);
    },
  });
}

/** Discord's React module — a resolving proxy, never undefined (see lazyModule). */
let reactProxy: BdReact | undefined;
export const getReact = (): BdReact =>
  (reactProxy ??= lazyModule<BdReact>(
    () => discovery().find(hasKeys("createElement", "cloneElement")) as BdReact | undefined,
    "BdApi.React",
  ));

/**
 * Discord's React when its chunk has evaluated, undefined before. The
 * resolving proxy throws on property access while unloaded, so touching
 * one member doubles as the availability check — callers that degrade
 * gracefully (hooks, menu patchers, component factories) use this
 * instead of getReact().
 */
export function loadedReact(): BdReact | undefined {
  try {
    const React = getReact();
    if (typeof React.createElement !== "function") return undefined;
    return React;
  } catch {
    return undefined;
  }
}

/**
 * Discord's react-dom: the base module plus the client module, merged the
 * way upstream merges them. Before the client chunk has loaded, callers get
 * a base-only snapshot (identity stabilizes once both parts resolve).
 */
const getReactDomBase = deferred<BdReactDom>(
  () => discovery().find(hasKeys("createPortal")) as BdReactDom | undefined,
);
const getReactDomClient = deferred<BdReactDom>(
  () => discovery().find(hasKeys("createRoot")) as BdReactDom | undefined,
);

let reactDomMerged: BdReactDom | undefined;

/** Discord's react-dom — a resolving proxy, never undefined (see lazyModule). */
let reactDomProxy: BdReactDom | undefined;
export function getReactDOM(): BdReactDom {
  return (reactDomProxy ??= lazyModule<BdReactDom>(
    () => {
      const base = getReactDomBase();
      const client = getReactDomClient();
      if (base === undefined) return undefined;
      if (client === undefined) return base;
      reactDomMerged ??= Object.assign({}, base, client);
      return reactDomMerged;
    },
    "BdApi.ReactDOM",
    // Base-only is a stopgap: keep polling the lookup until the client
    // chunk lands and the merged module takes over.
    (value) => typeof (value as Record<string, unknown>)["createRoot"] === "function",
  ));
}

/** Discord's Flux dispatcher. */
export const getDispatcher = deferred<BdDispatcher>(() => {
  const found = discovery().find(hasKeys("dispatch", "subscribe", "register"));
  if (found === undefined || found === null) return undefined;
  return found as BdDispatcher;
});

/**
 * Discord's notice-layer layout classes (`base` is the class of the chat
 * column container notices are prepended into) — found the way upstream
 * finds them.
 */
export const getNoticesBaseClasses = deferred<{ base: string }>(
  () => discovery().find(hasKeys("container", "base", "sidebar")) as { base: string } | undefined,
);

/** Discord's error-page classes; notices re-mount there when the chat is replaced. */
export const getNoticesPageClasses = deferred<{ errorPage: string }>(
  () => discovery().find(hasKeys("errorPage")) as { errorPage: string } | undefined,
);
