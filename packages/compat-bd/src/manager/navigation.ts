/**
 * The in-page stand-in for BetterDiscord's navigation event.
 *
 * Upstream fires its renderer `navigate` event from the main process
 * (`did-navigate-in-page`, upstream `ipc.ts`); the page has no IPC here,
 * so the same moments are observed directly: Discord's SPA route changes
 * go through `history.pushState`/`replaceState`, and back/forward/hash
 * navigation surface as `popstate`/`hashchange`.
 *
 * The wrappers install once for the first subscriber and remove
 * themselves when the last one unsubscribes.
 */

type NavigateListener = () => void;

const listeners = new Set<NavigateListener>();
let uninstall: (() => void) | undefined;

function dispatch(): void {
  for (const listener of listeners) listener();
}

function install(): void {
  if (uninstall) return;
  const history = window.history;
  // The natives live on History.prototype; capture them before the wrappers
  // shadow them on the instance (bound once, so the wrappers do not depend
  // on their call-site `this`).
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  const onPopState = (): void => {
    dispatch();
  };
  const onHashChange = (): void => {
    dispatch();
  };

  history.pushState = (data: unknown, unused: string, url?: string | URL | null): void => {
    pushState(data, unused, url);
    dispatch();
  };
  history.replaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
    replaceState(data, unused, url);
    dispatch();
  };
  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);

  uninstall = (): void => {
    // The wrappers are own properties on the instance: deleting them
    // exposes the prototype's native methods again.
    delete (history as { pushState?: unknown }).pushState;
    delete (history as { replaceState?: unknown }).replaceState;
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
    uninstall = undefined;
  };
}

/**
 * Subscribes to in-page navigation; returns the unsubscribe function.
 * Every subscriber shares one set of History hooks, removed with the last
 * unsubscribe.
 */
export function subscribeNavigation(listener: NavigateListener): () => void {
  listeners.add(listener);
  install();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) uninstall?.();
  };
}
