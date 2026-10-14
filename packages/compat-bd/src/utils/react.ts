/**
 * React helpers shared by the BetterDiscord facade — a behavioral port of
 * BetterDiscord's src/betterdiscord/utils/react.ts (Apache-2.0, see
 * THIRD_PARTY.md): the `getType` resolver, the fiber/owner-instance
 * lookups, the DOM wrapper component, and the out-of-lifecycle hook
 * dispatcher swap (`wrapInHooks`).
 *
 * Unlike upstream, every helper reaches Discord's React through the lazy
 * module resolver instead of importing it: Ion's bundle evaluates before
 * Discord's, so the React singleton only exists by the time a plugin calls
 * these. (`getType` is import-free and is used by the webpack filters at
 * any time.)
 */

import { Logger } from "../common/logger";
import { loadedReact, type BdComponentClass, type BdReact } from "../modules/discord-modules";

const exoticComponents = {
  memo: Symbol.for("react.memo"),
  forwardRef: Symbol.for("react.forward_ref"),
  lazy: Symbol.for("react.lazy"),
} as const;

interface ReactElement {
  readonly $$typeof?: symbol;
  readonly type?: unknown;
  readonly render?: unknown;
  readonly _payload?: { _status?: number; _result?: { default?: unknown } | undefined } | undefined;
}

export function getType(elementType: unknown): unknown {
  let current = elementType;
  for (;;) {
    if (current == null || typeof current !== "object") return current;
    const element = current as ReactElement;
    const kind = element.$$typeof;
    if (kind === exoticComponents.memo) {
      current = element.type;
    } else if (kind === exoticComponents.forwardRef) {
      current = element.render;
    } else if (kind === exoticComponents.lazy) {
      const payload = element._payload;
      // Status 1 is React's "resolved" state; unresolved lazy values have
      // no usable component yet, so upstream substitutes a no-op.
      current = payload?._status === 1 ? payload._result?.default : (): undefined => undefined;
    } else {
      return current;
    }
  }
}

/** React's fiber tree, structural — the fields the instance lookups walk. */
export interface BdFiber {
  return: BdFiber | null;
  stateNode?: unknown;
  type?: unknown;
  [key: string]: unknown;
}

function reactOrFail(who: string): BdReact {
  const React = loadedReact();
  if (!React) {
    throw new Error(`BdApi.${who}: Discord's React is not loaded yet`);
  }
  return React;
}

/**
 * The React fiber attached to a DOM node, whichever internal key this
 * React version stamps it with.
 */
export function getInternalInstance(node: Element): BdFiber | null {
  const record = node as unknown as Record<string, unknown>;
  const key = Object.keys(node).find(
    (candidate) =>
      candidate.startsWith("__reactInternalInstance") || candidate.startsWith("__reactFiber"),
  );
  if (key) return record[key] as BdFiber;
  return null;
}

export interface GetOwnerInstanceOptions {
  /** Only accept owners whose display name is listed. */
  include?: readonly string[];
  /** Reject owners whose display name is listed (the default mode). */
  exclude?: readonly string[];
  /** Final check against the owner instance itself. */
  filter?: (owner: Record<string, unknown>) => boolean;
}

/**
 * Walks the fiber tree from `node` up to the nearest class component —
 * the "owner" instance plugins patch.
 */
export function getOwnerInstance(
  node: Element | undefined,
  {
    include,
    exclude = ["Popout", "Tooltip", "Scroller", "BackgroundFlash"],
    filter = () => true,
  }: GetOwnerInstanceOptions = {},
): Record<string, unknown> | null {
  if (!node) return null;
  const excluding = include === undefined;
  const nameFilter = excluding ? exclude : include;

  const getDisplayName = (fiber: BdFiber): string | null => {
    const type = fiber.type as { displayName?: string; name?: string } | null | undefined;
    if (!type) return null;
    return type.displayName ?? type.name ?? null;
  };

  const classFilter = (fiber: BdFiber): boolean => {
    const name = getDisplayName(fiber);
    return name !== null && nameFilter.includes(name) !== excluding;
  };

  let curr = getInternalInstance(node);
  while (curr?.return) {
    curr = curr.return;
    const owner = curr.stateNode;
    if (
      owner != null &&
      typeof owner === "object" &&
      !(owner instanceof HTMLElement) &&
      classFilter(curr) &&
      filter(owner as Record<string, unknown>)
    ) {
      return owner as Record<string, unknown>;
    }
  }

  return null;
}

/**
 * An unrendered React component that appends DOM elements into a wrapper
 * `div` when it mounts — the bridge plugins use to drop raw DOM into a
 * React tree.
 */
export function wrapElement(element: Element | Element[]): BdComponentClass {
  const React = reactOrFail("ReactUtils.wrapElement");
  const Base: BdComponentClass = React.Component;

  return class ReactWrapper extends Base {
    readonly element: Element | Element[];
    ref: { current: HTMLDivElement | null } = React.createRef() as {
      current: HTMLDivElement | null;
    };

    constructor(props: Record<string, unknown>) {
      super(props);
      this.element = element;
      this.state = { hasError: false };
    }

    componentDidCatch(): void {
      this.setState({ hasError: true });
    }

    componentDidMount(): void {
      const refElement = this.ref.current;
      if (!refElement) return;
      if (Array.isArray(this.element)) {
        this.element.forEach((child) => refElement.appendChild(child));
      } else {
        refElement.appendChild(this.element);
      }
    }

    override render(): unknown {
      if ((this.state as { hasError?: boolean }).hasError) return null;
      return React.createElement("div", { className: "react-wrapper", ref: this.ref });
    }
  };
}

interface ContextLike {
  readonly _currentValue: unknown;
}

/** React's use() error when a promise has not resolved inside render. */
const USE_ERR_MSG =
  "Minified React error #460; visit https://react.dev/errors/460 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";

const NO_RESOLVE = Symbol("BetterDiscord.NoResolve");

/**
 * Stand-ins for React's hooks that function outside the normal render
 * lifecycle. Ported verbatim from upstream: state is captured once, effects
 * never run, and the promise form of `use` throws React's own suspense
 * error when unresolved.
 */
/** Stand-ins for React's hooks that function outside the normal render lifecycle. */
export interface PatchedReactHooks {
  use(usable: PromiseLike<unknown> | ContextLike): unknown;
  readContext(context: ContextLike): unknown;
  useFormState(
    action: (...args: unknown[]) => void,
    initialState: unknown,
    permalink?: string,
  ): [state: unknown, dispatch: () => void, isPending: boolean];
  useActionState(
    action: (...args: unknown[]) => void,
    initialState: unknown,
    permalink?: string,
  ): [state: unknown, dispatch: () => void, isPending: boolean];
  useOptimistic(passthrough: unknown): [state: unknown, dispatch: (action: unknown) => void];
  useMemo<T>(factory: () => T): T;
  useState<T>(initial: T | (() => T)): [state: T, setState: () => void];
  useReducer<T>(
    reducer: (state: T, action: unknown) => T,
    initial: T,
  ): [state: T, dispatch: () => void];
  useRef<T>(value: T | null): { current: T | null };
  useCallback<T extends (...args: never[]) => unknown>(callback: T): T;
  useContext(context: ContextLike): unknown;
  useEffect(): void;
  useLayoutEffect(): void;
  useImperativeHandle(): void;
  useTransition(): [isPending: boolean, startTransition: (callback: () => void) => void];
  useInsertionEffect(): void;
  useDebugValue(): void;
  useDeferredValue<T>(value: T): T;
  useSyncExternalStore<T>(subscribe: () => void, getSnapshot: () => T): T;
  useId(): string;
}

const patchedReactHooks: PatchedReactHooks = {
  use(usable) {
    if (typeof (usable as PromiseLike<unknown>).then === "function") {
      let value: unknown = NO_RESOLVE;
      (usable as PromiseLike<unknown>).then((resolved) => {
        value = resolved;
      });
      if (value === NO_RESOLVE) throw new Error(USE_ERR_MSG);
      return value;
    }
    return (usable as ContextLike)._currentValue;
  },
  readContext(context) {
    return context._currentValue;
  },
  useFormState(_action, initialState) {
    return [initialState, () => undefined, false];
  },
  useActionState(_action, initialState) {
    return [initialState, () => undefined, false];
  },
  useOptimistic(passthrough) {
    return [passthrough, () => undefined];
  },
  useMemo(factory) {
    return factory();
  },
  useState<T>(initial: T | (() => T)): [state: T, setState: () => void] {
    if (typeof initial === "function") return [(initial as () => T)(), () => undefined];
    return [initial, () => undefined];
  },
  useReducer(_reducer, initial) {
    return [initial, () => undefined];
  },
  useRef(value = null) {
    return { current: value };
  },
  useCallback(callback) {
    return callback;
  },
  useContext(context) {
    return context._currentValue;
  },
  useEffect() {
    // Effects are lifecycle-bound; there is no lifecycle out here.
  },
  useLayoutEffect() {
    // See useEffect.
  },
  useImperativeHandle() {
    // See useEffect.
  },
  useTransition() {
    return [
      false,
      (callback: () => void) => {
        callback();
      },
    ];
  },
  useInsertionEffect() {
    // See useEffect.
  },
  useDebugValue() {
    // Display-only; nothing to show outside devtools.
  },
  useDeferredValue(value) {
    return value;
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  },
  useId() {
    return Math.random().toString(36).slice(2, 11);
  },
};

/**
 * Wraps a functional component so it can render outside React's normal
 * lifecycle: while it runs, React's dispatcher is swapped to the stand-ins
 * above (plus any custom patches), then restored. Components reading state
 * get a stable snapshot; components needing real effects should not be
 * wrapped — same contract as upstream.
 */
export function wrapInHooks(
  functionComponent: unknown,
  customPatches: Partial<PatchedReactHooks> = {},
): (props: Record<string, unknown>) => unknown {
  const React = reactOrFail("ReactUtils.wrapInHooks");
  const FC = getType(functionComponent);

  return function wrappedComponent(props: Record<string, unknown>): unknown {
    const reactDispatcher =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?.H;
    if (!reactDispatcher || typeof FC !== "function") {
      // React renamed its private handle (or the type is not callable):
      // render as-is instead of breaking the component outright.
      Logger.error(
        "ReactUtils~wrapInHooks",
        "React's dispatcher handle is unavailable; rendering without hook patches.",
      );
      return typeof FC === "function"
        ? (FC as (p: Record<string, unknown>) => unknown)(props)
        : undefined;
    }

    const originalDispatcher = { ...reactDispatcher };
    Object.assign(reactDispatcher, patchedReactHooks, customPatches);

    try {
      return (FC as (p: Record<string, unknown>) => unknown)(props);
    } catch (error) {
      // The suspense-style error from an unresolved use(): render nothing.
      if (error instanceof Error && error.message === USE_ERR_MSG) return undefined;
      throw error;
    } finally {
      Object.assign(reactDispatcher, originalDispatcher);
    }
  };
}
