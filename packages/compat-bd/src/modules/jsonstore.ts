/**
 * Plugin data storage — BetterDiscord's JsonStore
 * (src/betterdiscord/stores/json.ts, Apache-2.0, see THIRD_PARTY.md) with
 * the persistence layer swapped: upstream writes one `.config.json` file per
 * plugin through Node's filesystem, while Ion's plugin environment has no
 * filesystem, so each plugin's data lives in one DOM storage entry
 * (JSON-encoded, same pretty-printed shape). The API `BdApi.Data` exposes —
 * save/load/delete/recache — behaves the same: falsey values survive a
 * round-trip, saving `undefined` is a no-op (delete instead), and a
 * corrupted blob reads as empty data while `recache` reports the failure.
 *
 * The backing area is core's captured reference, never `window.localStorage`:
 * Discord's client deletes that property from the window after load, so a lazy
 * lookup would find `undefined` and every `Data.save` would throw.
 */

import { Logger } from "../common/logger";
import { Store } from "../common/store";
import { domStorage } from "../host";

const STORAGE_PREFIX = "ION_BD_DATA_";

function storageKey(pluginName: string): string {
  return `${STORAGE_PREFIX}${pluginName}`;
}

class JsonStore extends Store {
  readonly #cache = new Map<string, Record<string, unknown>>();

  /** Returns the stored value; reads blindly so falsey values survive. */
  getData(pluginName: string, key: string): unknown {
    return this.#ensureData(pluginName)[key];
  }

  setData(pluginName: string, key: string, value: unknown): void {
    if (value === undefined) return; // Can't set undefined, use deleteData

    this.#ensureData(pluginName)[key] = value;
    this.#save(pluginName);
  }

  deleteData(pluginName: string, key: string): void {
    // Reflected, since the key is dynamic by design: deleting is the API.
    Reflect.deleteProperty(this.#ensureData(pluginName), key);
    this.#save(pluginName);
  }

  /**
   * Drops the in-memory cache and re-reads the backing store. Upstream
   * warns that recache can block on the filesystem; here it only re-parses
   * one storage entry, but the API and failure reporting match.
   *
   * @returns Whether the data reloaded cleanly.
   */
  recache(pluginName: string): boolean {
    this.#cache.delete(pluginName);
    try {
      this.#cache.set(pluginName, this.#read(pluginName));
      this.emitChange();
      return true;
    } catch (error) {
      Logger.error("JsonStore", "recache: ", error);
      return false;
    }
  }

  /** Reads the backing entry; throws on malformed JSON (callers decide). */
  #read(pluginName: string): Record<string, unknown> {
    const raw = domStorage().read(storageKey(pluginName));
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Failed to parse data for ${pluginName}`, { cause: error });
    }
  }

  #ensureData(pluginName: string): Record<string, unknown> {
    const cached = this.#cache.get(pluginName);
    if (cached) return cached;

    let data: Record<string, unknown>;
    try {
      data = this.#read(pluginName);
    } catch {
      data = {}; // Upstream: a corrupt file reads as blank data.
    }
    this.#cache.set(pluginName, data);
    return data;
  }

  #save(pluginName: string): void {
    // Upstream writes through `fs` and lets failures propagate; quota and
    // serialization errors surface to the calling plugin the same way.
    domStorage().write(
      storageKey(pluginName),
      JSON.stringify(this.#cache.get(pluginName), null, 4),
    );
    this.emitChange();
  }
}

export default new JsonStore();
