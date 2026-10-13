/**
 * `shelter.observeDom` — a shared, reference-counted `MutationObserver`.
 *
 * A direct port of uwu/shelter's `src/observer.ts` (CC0-1.0, itself credited
 * to kaihax's patcher; see THIRD_PARTY.md): one observer serves every
 * subscriber, `querySelectorAll` runs against every changed element, and the
 * observer disconnects when the last subscriber leaves — creating itself on
 * the first observation rather than at load. Each returned unsubscribe also
 * carries `.now()`, which cancels the observation and skips the callbacks
 * still queued behind it.
 */

type MutationNode = HTMLElement | SVGElement;
type ObserverCallback = (element: MutationNode) => void;

/** `[selector, callback, already-cancelled]` */
type Observation = [string, ObserverCallback, boolean];

/** What `observe` returns: an unsubscribe, plus its `now()` variant. */
export interface Unobserve {
  (): void;
  /** Cancels the observation and skips the callbacks still queued for it. */
  now(): void;
}

const observations = new Set<Observation>();

function handleRecords(records: MutationRecord[]): void {
  // De-duplicate: several records can describe the same element.
  const changed = new Set<MutationNode>();

  for (const record of records) {
    changed.add(record.target as MutationNode);
    for (const removed of record.removedNodes) {
      if (removed instanceof HTMLElement || removed instanceof SVGElement) changed.add(removed);
    }
  }

  for (const element of changed) {
    for (const observation of observations) {
      const [selector, callback, cancelled] = observation;
      if (element.matches(selector)) callback(element);
      element.querySelectorAll(selector).forEach((found) => {
        if (cancelled) return;
        if (found instanceof HTMLElement || found instanceof SVGElement) callback(found);
      });
    }
  }
}

/**
 * The one shared observer, created the first time a plugin observes rather
 * than when the adapter loads — a document observer is work, and the client
 * only pays for it if something actually asks for one.
 */
let observer: MutationObserver | undefined;

const startObserving = (): void => {
  observer ??= new MutationObserver(handleRecords);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
};

const stopObserving = (): void => {
  observer?.disconnect();
};

/** Observes `selector`; the callback fires for matching added/changed nodes. */
export function observe(selector: string, callback: ObserverCallback): Unobserve {
  if (observations.size === 0) startObserving();

  const entry: Observation = [selector, callback, false];
  observations.add(entry);

  const unsubscribe = (): void => {
    observations.delete(entry);
    if (observations.size === 0) stopObserving();
  };

  unsubscribe.now = (): void => {
    entry[2] = true;
    unsubscribe();
  };

  return unsubscribe;
}

/** Drops every observation and disconnects; shelter calls it on unload. */
export function unobserve(): void {
  observations.clear();
  stopObserving();
}
