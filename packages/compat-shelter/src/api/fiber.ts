/**
 * Reading React's fiber tree off the page.
 *
 * A strict-types port of upstream shelter's `util.getFiber` and
 * `util.reactFiberWalker` (uwu/shelter, CC0-1.0 — see THIRD_PARTY.md). They
 * exist here for one reason: a settings section plugin must redraw Discord's
 * settings modal when it registers, and Discord keeps the layout tree in
 * React state with no public handle on it. Walking to it through the fiber
 * of a settings row is how upstream reaches it too.
 *
 * Everything below is reflection into React internals, so every read is
 * guarded: a missing fiber, a renamed internal, or a fiber that turns out
 * not to be Discord's answers `undefined` or an empty list rather than
 * throwing — the caller here is a plugin's `onLoad`, and a client mod must
 * never take Discord down over a React rename.
 */

/** React's internal fiber, reduced to the fields this adapter reads. */
export interface ReactFiber {
  readonly return?: ReactFiber | null;
  readonly child?: ReactFiber | null;
  readonly sibling?: ReactFiber | null;
  /** The component type, or a tag name string for host elements. */
  readonly type?: unknown;
  readonly stateNode?: unknown;
  readonly pendingProps?: Record<string, unknown> | null;
  readonly memoizedProps?: Record<string, unknown> | null;
  /** Head of the fiber's hook list; shape is React's, not ours. */
  readonly memoizedState?: unknown;
}

/** A state update function, as React hands them out in a hook's queue. */
export type FiberDispatch = (update: unknown) => void;

/** One link of a fiber's hook list. Only the fields read here are declared. */
interface HookLink {
  readonly next?: HookLink | null;
  readonly memoizedState?: unknown;
  readonly queue?: { readonly dispatch?: FiberDispatch };
}

/** React hangs the fiber on the element under a key with this prefix. */
const FIBER_KEY_PREFIX = "__reactFiber$";

/**
 * React's per-instance suffix is stable for one React instance, so it is
 * resolved once and reused. A miss falls back to a fresh scan rather than
 * reusing a key that no longer hits, which is what happens after a client
 * reloads the renderer under us.
 */
let fiberKey: string | undefined;

function readFiber(element: Element, key: string): ReactFiber | undefined {
  const value: unknown = Reflect.get(element, key);
  return typeof value === "object" && value !== null ? value : undefined;
}

/** The fiber React stored on `element`, or undefined when there is none. */
export function getFiber(element: Element): ReactFiber | undefined {
  if (fiberKey !== undefined) {
    const cached = readFiber(element, fiberKey);
    if (cached !== undefined) return cached;
  }
  const found = Object.keys(element).find((key) => key.startsWith(FIBER_KEY_PREFIX));
  if (found === undefined) return undefined;
  fiberKey = found;
  return readFiber(element, found);
}

/** A predicate over one fiber, in the shape the walker expects. */
export type FiberPredicate = (fiber: ReactFiber) => boolean;

/**
 * Depth-first walk of the fiber tree: up the `return` chain when `goUp`,
 * down `child` then across `sibling` otherwise. `ignoreStringTypes` skips
 * host elements, which is what a search for a component fiber wants. The
 * recursion limit is a bound on a cyclic-looking tree, not a tuning knob.
 */
export function walkFiber(
  node: ReactFiber | null | undefined,
  predicate: FiberPredicate,
  goUp = false,
  ignoreStringTypes = false,
  limit = 100,
): ReactFiber | undefined {
  if (node === null || node === undefined || limit === 0) return undefined;
  if (predicate(node) && (!ignoreStringTypes || typeof node.type !== "string")) return node;
  const down = walkFiber(
    goUp ? node.return : node.child,
    predicate,
    goUp,
    ignoreStringTypes,
    limit - 1,
  );
  return down ?? walkFiber(node.sibling, predicate, goUp, ignoreStringTypes, limit - 1);
}

/** Every hook link in a fiber's state, in the order React stores them. */
function hookLinks(fiber: ReactFiber): readonly HookLink[] {
  const links: HookLink[] = [];
  let link: HookLink | null | undefined = fiber.memoizedState as HookLink | null | undefined;
  while (link !== null && link !== undefined) {
    links.push(link);
    link = link.next;
  }
  return links;
}

/** The state value of every hook in a fiber, in order. */
export function hookStates(fiber: ReactFiber): readonly unknown[] {
  return hookLinks(fiber).map((link) => link.memoizedState);
}

/**
 * The dispatch functions of every hook whose state is a `Set`.
 *
 * That is the settings modal's shape: it holds its open sections in a Set,
 * and handing React a new Set is enough to make it render again.
 */
export function setStateDispatchers(fiber: ReactFiber): readonly FiberDispatch[] {
  const dispatchers: FiberDispatch[] = [];
  for (const link of hookLinks(fiber)) {
    const dispatch = link.queue?.dispatch;
    if (link.memoizedState instanceof Set && typeof dispatch === "function") {
      dispatchers.push(dispatch);
    }
  }
  return dispatchers;
}
