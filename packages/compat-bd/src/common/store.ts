/**
 * BetterDiscord's base store — a port of src/betterdiscord/stores/base.ts
 * (Apache-2.0, see THIRD_PARTY.md). A tiny change-emitter that plugins
 * subclass and expose as `BdApi.Utils.Store`.
 */

export class Store {
  readonly #listeners = new Set<() => void>();

  /** BD calls this on its own stores during startup; subclasses override it. */
  initialize(): void {
    // Intentionally empty: upstream's base implementation is a no-op hook.
  }

  /** Subscribes to changes; the returned function unsubscribes. */
  addChangeListener(callback: () => void): () => void {
    this.#listeners.add(callback);
    return () => {
      this.removeChangeListener(callback);
    };
  }

  removeChangeListener(callback: () => void): void {
    this.#listeners.delete(callback);
  }

  emitChange(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

Object.freeze(Store);
Object.freeze(Store.prototype);
