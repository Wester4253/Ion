/**
 * `shelter.util` — the helpers every Shelter plugin reaches for.
 *
 * A behavioural port of uwu/shelter's `src/util/index.ts` (CC0-1.0, see
 * THIRD_PARTY.md): React fiber walking, the dispatcher subscription
 * helpers, and the small promise/store utilities, with the same names,
 * defaults, and traversal order. The one thing that differs is how the
 * dispatcher is obtained — upstream resolves it through its own Flux
 * discovery, here it is already on `shelter.flux`.
 *
 * `createScopedApi` lives in `scoped.ts` and is attached to this surface
 * the way upstream's `windowApi` binds it: with the resolved dispatcher.
 */

import { batch, createSignal, onCleanup } from "solid-js";

import type { FluxSurface } from "./flux";

import { shelterLog } from "../logger";

/** React's reconciler node, as upstream's `Fiber` type describes it. */
export interface Fiber {
  type: unknown;
  pendingProps?: Record<PropertyKey, unknown>;
  memoizedProps?: Record<PropertyKey, unknown>;
  memoizedState?: unknown;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  stateNode: FiberOwner | Element | null;
  [key: string]: unknown;
}

/**
 * A class component instance owning a subtree: what `getFiberOwner` hands
 * back when a plugin needs the component behind a DOM node.
 */
export interface FiberOwner {
  context: unknown;
  props: Record<PropertyKey, unknown>;
  refs: object;
  state: Record<PropertyKey, unknown>;
  updater: object;
  _reactInternals: Fiber;
  [key: string]: unknown;
}

/** A Flux store, as the subscription helpers call it. */
export interface FluxStore {
  addChangeListener(callback: () => void): void;
  removeChangeListener(callback: () => void): void;
  readonly [key: string]: unknown;
}

const FIBER_PREFIX = "__reactFiber$";
const PROPS_PREFIX = "__reactProps$";

/**
 * The random key React appends after `__reactFiber$` is the same for every
 * element an instance created, so it is cached after the first lookup —
 * upstream's reasoning, kept as is.
 */
let fiberKey: string | undefined;

export function getFiber(node: Element): Fiber | undefined {
  const record = node as unknown as Record<string, unknown>;
  if (fiberKey !== undefined && record[fiberKey] !== undefined) return record[fiberKey] as Fiber;
  const key = Object.keys(node).find((candidate) => candidate.startsWith(FIBER_PREFIX));
  if (key === undefined) return undefined;
  fiberKey = key;
  return record[key] as Fiber;
}

let propsKey: string | undefined;

export function getProps(node: Element): Record<PropertyKey, unknown> | undefined {
  const record = node as unknown as Record<string, unknown>;
  if (propsKey !== undefined && record[propsKey] !== undefined) {
    return record[propsKey] as Record<PropertyKey, unknown>;
  }
  const key = Object.keys(node).find((candidate) => candidate.startsWith(PROPS_PREFIX));
  if (key === undefined) return undefined;
  propsKey = key;
  return record[key] as Record<PropertyKey, unknown>;
}

/**
 * The class component that owns a node or fiber: the nearest ancestor whose
 * `stateNode` is a React instance rather than a DOM element. Walking up is
 * upstream's, including the property-name overload of the walker below.
 */
export function getFiberOwner(node: Element | Fiber): FiberOwner | undefined {
  const isElement = node instanceof Element;
  const start = isElement ? getFiber(node) : node;
  // `!= null` rather than `!== null`: React leaves `stateNode` unset on some
  // fibers even though its own types declare `| null`.
  const ownerFilter = (fiber: Fiber): boolean =>
    fiber.stateNode != null && !(fiber.stateNode instanceof Element);
  const owner = reactFiberWalker(start, ownerFilter, true)?.stateNode;
  return owner instanceof Element || owner === null || owner === undefined ? undefined : owner;
}

/**
 * Depth-first walk over React's fiber tree. `filter` may be a predicate, or
 * a property name (or symbol) looked up on `pendingProps` — the overload
 * upstream supports and plugins rely on.
 */
export function reactFiberWalker(
  node: Fiber | undefined | null,
  filter: string | symbol | ((node: Fiber) => boolean),
  goUp = false,
  ignoreStringType = false,
  recursionLimit = 100,
): Fiber | undefined | null {
  if (recursionLimit === 0) return undefined;
  if (!node) return undefined;

  let predicate: (fiber: Fiber) => boolean;
  if (typeof filter === "function") {
    predicate = filter;
  } else {
    const property = filter;
    predicate = (fiber) => fiber.pendingProps?.[property] !== undefined;
  }

  const typeIsString = typeof node.type === "string";
  if (predicate(node) && (!ignoreStringType || !typeIsString)) return node;

  return (
    reactFiberWalker(
      goUp ? node.return : node.child,
      predicate,
      goUp,
      ignoreStringType,
      recursionLimit - 1,
    ) ?? reactFiberWalker(node.sibling, predicate, goUp, ignoreStringType, recursionLimit - 1)
  );
}

/** What `shelter.util` exposes, minus the scoped factory `windowApi` binds. */
export interface UtilSurface {
  log(text: unknown, level?: "log" | "warn" | "error"): void;
  getFiber(node: Element): Fiber | undefined;
  getProps(node: Element): Record<PropertyKey, unknown> | undefined;
  getFiberOwner(node: Element | Fiber): FiberOwner | undefined;
  reactFiberWalker: typeof reactFiberWalker;
  awaitDispatch(
    filter: string | ((payload: Record<string, unknown>) => boolean),
  ): Promise<Record<string, unknown>>;
  createListener(type: string): () => unknown;
  createSubscription<TState, TStore extends FluxStore>(
    store: TStore,
    getStateFromStore: (store: TStore) => TState,
  ): () => TState;
  storeAssign<T extends object>(store: T, toApply: T): T;
  sleep(ms?: number): Promise<void>;
  prettifyError(error: unknown): string;
}

/**
 * Pretty-prints an error the way Chromium labels one, including the
 * constructor name when the value is not a real `Error`.
 */
export function prettifyError(error: unknown): string {
  if (typeof error !== "object" || error === null) return `[Unknown Error]: ${String(error)}`;

  const candidate = error as {
    constructor?: { name?: string };
    stack?: unknown;
    message?: unknown;
  };
  const rawName = candidate.constructor?.name;
  const name = rawName === undefined || rawName === "Object" ? "[Unknown Error]" : rawName;

  // Only a string message is interpolated: stringifying an arbitrary value
  // here would print `[object Object]` for every error that lacks one.
  const detail = typeof candidate.message === "string" ? candidate.message : "";
  const labelled = detail === "" ? name : `${name}: ${detail}`;

  if (typeof candidate.stack === "string") {
    if (candidate.stack.startsWith(name)) return candidate.stack;
    return `${labelled}\n${candidate.stack}`;
  }
  return labelled;
}

/** Builds `shelter.util` around the resolved flux surface. */
export function createUtilSurface(flux: FluxSurface): UtilSurface {
  return {
    log: shelterLog,
    getFiber,
    getProps,
    getFiberOwner,
    reactFiberWalker,

    async awaitDispatch(filter) {
      const matches =
        typeof filter === "string"
          ? (payload: Record<string, unknown>) => payload["type"] === filter
          : filter;
      return await new Promise<Record<string, unknown>>((resolve) => {
        const unintercept = flux.intercept((payload) => {
          if (matches(payload)) {
            resolve(payload);
            unintercept();
          }
        });
      });
    },

    createListener(type: string) {
      const [data, setData] = createSignal<unknown>(undefined);
      const dispatch = (payload: Record<string, unknown>): void => {
        setData(() => payload);
      };
      flux.dispatcher.subscribe(type, dispatch);
      onCleanup(() => {
        flux.dispatcher.unsubscribe(type, dispatch);
      });
      return data;
    },

    createSubscription<TState, TStore extends FluxStore>(
      store: TStore,
      getStateFromStore: (store: TStore) => TState,
    ) {
      const [data, setData] = createSignal<TState>(getStateFromStore(store));
      const changed = (): void => {
        setData(() => getStateFromStore(store));
      };
      store.addChangeListener(changed);
      onCleanup(() => {
        store.removeChangeListener(changed);
      });
      return data;
    },

    storeAssign<T extends object>(store: T, toApply: T): T {
      return batch(() => Object.assign(store, toApply));
    },

    sleep(ms = 0): Promise<void> {
      return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    },

    prettifyError,
  };
}
