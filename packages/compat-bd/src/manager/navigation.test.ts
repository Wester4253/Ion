// @vitest-environment happy-dom
/**
 * Unit tests for the in-page navigation hook: every route-change surface
 * notifies subscribers through one shared install, and the last unsubscribe
 * removes the History wrappers again.
 */

import { describe, expect, it } from "vitest";

import { subscribeNavigation } from "./navigation";

function hasOwnHistoryMethod(): boolean {
  return Object.hasOwn(history, "pushState") && Object.hasOwn(history, "replaceState");
}

describe("subscribeNavigation", () => {
  it("notifies on pushState, replaceState, popstate, and hashchange", () => {
    let count = 0;
    const unsubscribe = subscribeNavigation(() => {
      count++;
    });
    expect(hasOwnHistoryMethod()).toBe(true);

    history.pushState({}, "", "/one");
    expect(count).toBe(1);
    history.replaceState({}, "", "/two");
    expect(count).toBe(2);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(count).toBe(3);
    window.dispatchEvent(new Event("hashchange"));
    expect(count).toBe(4);

    unsubscribe();
    expect(hasOwnHistoryMethod()).toBe(false);
    history.pushState({}, "", "/three");
    expect(count).toBe(4);
  });

  it("keeps the hook while any subscriber remains", () => {
    let first = 0;
    let second = 0;
    const unsubscribeFirst = subscribeNavigation(() => {
      first++;
    });
    const unsubscribeSecond = subscribeNavigation(() => {
      second++;
    });

    history.pushState({}, "", "/both");
    expect(first).toBe(1);
    expect(second).toBe(1);

    // The first unsubscribe leaves the shared hooks installed for the second.
    unsubscribeFirst();
    expect(hasOwnHistoryMethod()).toBe(true);
    history.pushState({}, "", "/second-only");
    expect(first).toBe(1);
    expect(second).toBe(2);

    unsubscribeSecond();
    expect(hasOwnHistoryMethod()).toBe(false);
  });
});
