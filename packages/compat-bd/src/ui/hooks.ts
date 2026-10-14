/**
 * React hooks BetterDiscord exposes to plugins — a behavioral port of
 * src/betterdiscord/ui/hooks.ts (Apache-2.0, see THIRD_PARTY.md):
 * `useStateFromStores` (subscribe to Flux stores, re-render on change) and
 * `useForceUpdate`.
 *
 * Upstream imports `shallowEqual` from fast-equals; the same check is a
 * handful of lines, so it lives here instead of adding a dependency.
 * Discord's React is resolved lazily (see modules/discord-modules.ts).
 */

import { loadedReact } from "../modules/discord-modules";

/** A store anything with change listeners — Discord's Flux stores or BdApi.Utils.Store. */
export interface StoreLike {
  addChangeListener(listener: () => void): void;
  removeChangeListener(listener: () => void): void;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bRecord, key)) return false;
    if (!Object.is(aRecord[key], bRecord[key])) return false;
  }
  return true;
}

/** A hook that forces a re-render when called. */
export function useForceUpdate(): [count: number, forceUpdate: () => void] {
  const React = loadedReact();
  if (!React) return [0, () => undefined];
  const [count, dispatch] = React.useReducer((num: number) => num + 1, 0);
  return [
    count,
    () => {
      dispatch();
    },
  ];
}

/**
 * Subscribes to one or more stores and re-computes a value when they
 * change, causing a re-render when the value is not equal to the previous
 * one.
 *
 * @param stores The store(s) to subscribe to
 * @param factory Computes the value to return when stores change
 * @param deps Optional dependency list controlling when the factory updates
 * @param isStateEqual `true` for a shallow check, or a custom comparator
 */
export function useStateFromStores<T>(
  stores: StoreLike | readonly StoreLike[],
  factory: () => T,
  deps?: readonly unknown[],
  isStateEqual: true | ((oldState: T, newState: T) => boolean) = (oldState, newState) =>
    oldState === newState,
): T {
  const React = loadedReact();
  if (!React) return factory();

  const [, forceUpdate] = React.useReducer((num: number) => num + 1, 0);
  const state = React.useRef<T | undefined>(undefined);
  const factoryRef = React.useRef<(() => T) | undefined>(undefined);

  const compareRef = React.useRef<((oldState: T, newState: T) => boolean) | undefined>(undefined);
  compareRef.current = isStateEqual === true ? shallowEqual : isStateEqual;

  if (factoryRef.current === undefined) {
    factoryRef.current = factory;
    state.current = factory();
  }

  const prevDeps = React.useRef<readonly unknown[] | undefined>(undefined);
  if (deps && prevDeps.current) {
    if (deps.length !== prevDeps.current.length) {
      throw new Error("Dependency List Size Changed!");
    }

    for (let index = 0; index < deps.length; index++) {
      if (Object.is(deps[index], prevDeps.current[index])) continue;

      factoryRef.current = factory;
      const newState = factory();
      if (!compare(state.current as T, newState)) state.current = newState;
      break;
    }
  } else {
    // No deps: update the factory on every render, as upstream does.
    factoryRef.current = factory;
  }

  prevDeps.current = deps;

  React.useInsertionEffect(() => {
    // `Array.isArray` does not narrow readonly arrays out of the union, so
    // each branch states the element type explicitly.
    const subscribed: readonly StoreLike[] = Array.isArray(stores)
      ? (stores as readonly StoreLike[])
      : [stores as StoreLike];
    const listener = (): void => {
      const currentFactory = factoryRef.current;
      if (!currentFactory) return;
      const newState = currentFactory();
      if (!compare(state.current as T, newState)) {
        state.current = newState;
        forceUpdate();
      }
    };

    for (const store of subscribed) store.addChangeListener(listener);
    return () => {
      for (const store of subscribed) store.removeChangeListener(listener);
    };
  }, []);

  function compare(oldState: T, newState: T): boolean {
    const comparator = compareRef.current;
    return comparator ? comparator(oldState, newState) : Object.is(oldState, newState);
  }

  return state.current as T;
}
