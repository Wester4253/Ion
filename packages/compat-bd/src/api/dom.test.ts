// @vitest-environment happy-dom
/**
 * Unit tests for the `BdApi.DOM` surface: style injection/removal (including
 * the bound plugin-name scoping), element creation with flattened children
 * and the deprecated `target` option, HTML parsing shapes, the node
 * add/remove watchers, and JS animation with a stubbed frame loop.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// These tests pin console output for the deprecated-option warning, which
// the compat harness would surface; referencing the spied method is the point.
/* eslint-disable no-console */

import { DOMManager } from "../modules/dommanager";
import { BoundDOM, DOM } from "./dom";

const dom = new DOM();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const node of Array.from(document.body.childNodes)) node.remove();
  // Every <style> in head was injected by these tests; happy-dom starts clean.
  for (const node of Array.from(document.head.querySelectorAll("style"))) node.remove();
});

describe("styles", () => {
  it("injects, updates in place, and removes styles by id", () => {
    dom.addStyle("test-css", ".a { color: red; }");
    const style = document.getElementById("test-css");
    expect(style?.textContent).toBe(".a { color: red; }");
    expect(document.head.contains(style)).toBe(true);

    dom.addStyle("test-css", ".a { color: blue; }");
    expect(document.querySelectorAll("#test-css")).toHaveLength(1);
    expect(style?.textContent).toBe(".a { color: blue; }");

    dom.removeStyle("test-css");
    expect(document.getElementById("test-css")).toBeNull();
  });

  it("throws without css or id, as upstream does", () => {
    expect(() => {
      dom.addStyle("test-x", "");
    }).toThrow("No css provided");
    expect(() => {
      dom.removeStyle("");
    }).toThrow("No id provided");
  });

  it("escapes ids so odd characters survive the round-trip", () => {
    dom.addStyle("test my theme!", ".a {}");
    expect(document.getElementById(CSS.escape("test my theme!"))).not.toBeNull();
  });

  it("scopes a bound instance's style id to the plugin name", () => {
    const bound = new BoundDOM("MyPlugin");
    bound.addStyle(".bound {}");
    expect(document.getElementById("MyPlugin")?.textContent).toBe(".bound {}");

    bound.removeStyle();
    expect(document.getElementById("MyPlugin")).toBeNull();
  });

  it("removes an explicitly given id from a bound instance", () => {
    const bound = new BoundDOM("MyPlugin");
    bound.addStyle("test-other", ".other {}");
    bound.removeStyle("test-other");
    expect(document.getElementById("test-other")).toBeNull();
  });
});

describe("createElement", () => {
  it("assigns options and flattens nested children", () => {
    const child = document.createElement("span");
    const element = dom.createElement("div", { id: "test-el" }, "text", [child, null, ["nested"]]);

    expect(element.id).toBe("test-el");
    expect(element.childNodes).toHaveLength(3);
    expect(element.childNodes[0]?.nodeValue).toBe("text");
    expect(element.childNodes[1]).toBe(child);
    expect(element.childNodes[2]?.nodeValue).toBe("nested");
  });

  it("appends to the deprecated target option and warns", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const host = document.createElement("div");
    document.body.append(host);

    // The API's type dropped `target`; JavaScript plugins still pass it, so
    // the manager keeps (and warns about) the behavior.
    const element = DOMManager.createElement("span", { target: host });

    expect(host.contains(element)).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]).toContain(
      'Usage of the "target" option has been deprecated and will be removed in the next version.',
    );
  });
});

describe("parseHTML", () => {
  it("returns a DocumentFragment with fragment: true", () => {
    expect(dom.parseHTML("<p>a</p><p>b</p>", true)).toBeInstanceOf(DocumentFragment);
  });

  it("returns a node list for multiple nodes and a single node otherwise", () => {
    const nodes = dom.parseHTML("<p>a</p><p>b</p>");
    expect(nodes).toHaveLength(2);
    expect((dom.parseHTML("<p>only</p>") as Element).tagName).toBe("P");
  });
});

describe("onAdded", () => {
  it("fires immediately when the node already exists", () => {
    const existing = document.createElement("div");
    existing.id = "test-present";
    document.body.append(existing);

    const seen: Element[] = [];
    const cancel = dom.onAdded("#test-present", (element) => {
      seen.push(element);
    });

    expect(cancel).toBeUndefined();
    expect(seen).toEqual([existing]);
  });

  it("waits for a matching node, fires once, then stops observing", async () => {
    const seen: Element[] = [];
    dom.onAdded(".test-late", (element) => {
      seen.push(element);
    });

    const first = document.createElement("div");
    first.className = "test-late";
    document.body.append(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([first]);

    const second = document.createElement("div");
    second.className = "test-late";
    document.body.append(second);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toHaveLength(1);
  });

  it("cancels a pending wait", async () => {
    const seen: Element[] = [];
    const cancel = dom.onAdded(".test-never", (element) => {
      seen.push(element);
    });
    expect(cancel).not.toBeUndefined();
    cancel?.();

    const matching = document.createElement("div");
    matching.className = "test-never";
    document.body.append(matching);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toHaveLength(0);
  });
});

describe("onRemoved", () => {
  it("fires when the node is removed", async () => {
    const node = document.createElement("div");
    document.body.append(node);

    let fired = 0;
    dom.onRemoved(node, () => {
      fired++;
    });

    node.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fired).toBe(1);
  });

  it("returns a cancel function that stops the observation", async () => {
    const node = document.createElement("div");
    document.body.append(node);

    let fired = 0;
    const cancel = dom.onRemoved(node, () => {
      fired++;
    });
    cancel();

    node.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fired).toBe(0);
  });
});

describe("animate", () => {
  it("drives updates through requestAnimationFrame and can be cancelled", () => {
    let now = 0;
    const frames: ((time: number) => void)[] = [];
    const cancelled: number[] = [];
    let nextFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
      frames.push(callback);
      nextFrameId++;
      return nextFrameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelled.push(id);
    });
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const progress: number[] = [];
    const cancel = dom.animate((value) => progress.push(value), 32);

    now = 16;
    frames.shift()?.(now);
    now = 32;
    frames.shift()?.(now);
    expect(progress).toEqual([0.5, 1]);

    cancel();
    expect(cancelled).toEqual([2]);
  });
});

describe("screen dimensions", () => {
  it("expose non-negative numbers", () => {
    expect(dom.screenWidth).toBeGreaterThanOrEqual(0);
    expect(dom.screenHeight).toBeGreaterThanOrEqual(0);
  });
});
