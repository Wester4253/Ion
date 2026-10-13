/**
 * `BdApi.Hooks` — React hooks with plugin scoping. A port of
 * src/betterdiscord/api/hooks.ts (Apache-2.0, see THIRD_PARTY.md).
 *
 * `useData` subscribes to the plugin data store so a component re-renders
 * when the plugin's key changes. Upstream listens per key; the adapter's
 * store emits per plugin, so the subscription is per plugin with the key's
 * value compared on every change — a re-render happens exactly when the
 * key's value changed, matching upstream's observable behavior.
 */

import JsonStore from "../modules/jsonstore";
import { useStateFromStores, useForceUpdate } from "../ui/hooks";

class BaseHooks {
  /**
   * Subscribes to one or more stores and re-computes a value when they
   * change, causing a re-render.
   */
  readonly useStateFromStores = useStateFromStores;

  /** Creates a hook that forces a re-render when called. */
  readonly useForceUpdate = useForceUpdate;
}

/**
 * `Hooks` is a utility class for React hooks; the static surface on
 * `BdApi`.
 */
export class Hooks extends BaseHooks {
  /**
   * Retrieves data from storage and re-renders when it changes.
   *
   * @param caller The name of the plugin to use data from
   * @param key The key of the data to retrieve
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- BD's useData is generic; keeping <T> keeps TypeScript plugins' `useData<MyType>(...)` calls compiling.
  useData<T>(caller: string, key: string): T {
    return useStateFromStores(JsonStore, () => JsonStore.getData(caller, key), [caller, key]) as T;
  }
}

/** `Hooks` with the plugin name pre-supplied, as on `new BdApi(name)`. */
export class BoundHooks extends BaseHooks {
  readonly #callerName: string;

  constructor(callerName: string) {
    super();
    this.#callerName = callerName;
  }

  /**
   * Retrieves the plugin's own data and re-renders when it changes.
   *
   * @param key The key of the data to retrieve
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see Hooks.useData.
  useData<T>(key: string): T {
    return useStateFromStores(JsonStore, () => JsonStore.getData(this.#callerName, key), [
      this.#callerName,
      key,
    ]) as T;
  }
}

Object.freeze(Hooks);
Object.freeze(Hooks.prototype);
Object.freeze(BoundHooks.prototype);
