/**
 * `BdApi.Data` — BetterDiscord's plugin-data surface. A port of
 * src/betterdiscord/api/data.ts (Apache-2.0, see THIRD_PARTY.md), reading
 * and writing through the adapter's localStorage-backed JsonStore (see
 * src/modules/jsonstore.ts for the persistence deviation).
 */

import JsonStore from "../modules/jsonstore";

/**
 * `Data` is a simple utility class for the management of plugin data. An
 * instance is available on {@link BdApi}.
 */
export class Data {
  /**
   * Saves JSON-serializable data.
   *
   * @param pluginName Name of the plugin saving data.
   * @param key Which piece of data to store.
   * @param data The data to be saved.
   */
  save(pluginName: string, key: string, data: unknown): void {
    JsonStore.setData(pluginName, key, data);
  }

  /**
   * Loads previously stored data.
   *
   * @param pluginName Name of the plugin loading data.
   * @param key Which piece of data to load.
   * @returns The stored data.
   */
  load(pluginName: string, key: string): unknown {
    return JsonStore.getData(pluginName, key);
  }

  /**
   * Recaches the JSON-serializable save data from the backing store.
   *
   * @param pluginName Name of the plugin recaching data.
   * @returns Whether the data successfully recached.
   */
  recache(pluginName: string): Promise<boolean> {
    return Promise.resolve(JsonStore.recache(pluginName));
  }

  /**
   * Deletes a piece of stored data. This is different than saving `null` or
   * `undefined`.
   *
   * @param pluginName Name of the plugin deleting data.
   * @param key Which piece of data to delete.
   */
  delete(pluginName: string, key: string): void {
    JsonStore.deleteData(pluginName, key);
  }
}

/**
 * `BoundData` is a simple utility class for the management of plugin data,
 * with plugin scoping automatically supplied. An instance is available on
 * instances of {@link BdApi}.
 */
export class BoundData {
  readonly #pluginName: string;

  constructor(pluginName: string) {
    this.#pluginName = pluginName;
  }

  /**
   * Saves JSON-serializable data.
   *
   * @param key Which piece of data to store.
   * @param data The data to be saved.
   */
  save(key: string, data: unknown): void {
    JsonStore.setData(this.#pluginName, key, data);
  }

  /**
   * Loads previously stored data.
   *
   * @param key Which piece of data to load.
   * @returns The stored data.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- BD's BoundData.load is generic; keeping <T> keeps TypeScript plugins' `load<MyType>(...)` calls compiling.
  load<T>(key: string): T {
    return JsonStore.getData(this.#pluginName, key) as T;
  }

  /**
   * Recaches the JSON-serializable save data from the backing store.
   *
   * @returns Whether the data successfully recached.
   */
  recache(): Promise<boolean> {
    return Promise.resolve(JsonStore.recache(this.#pluginName));
  }

  /**
   * Deletes a piece of stored data. This is different than saving `null` or
   * `undefined`.
   *
   * @param key Which piece of data to delete.
   */
  delete(key: string): void {
    JsonStore.deleteData(this.#pluginName, key);
  }
}

Object.freeze(Data);
Object.freeze(Data.prototype);
