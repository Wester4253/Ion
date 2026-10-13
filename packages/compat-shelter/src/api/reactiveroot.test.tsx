// @vitest-environment jsdom
/**
 * `shelter.ui.ReactiveRoot` in a DOM.
 *
 * jsdom, not happy-dom: happy-dom upgrades custom elements when they are
 * *connected*, so its constructor runs after the clone is handed out and
 * clobbers the `c` field ReactiveRoot's constructor declares — every render
 * then dies with "_self$.c is not a function". Chromium constructs at
 * `document.importNode` instead (checked against Electron 44: the constructor
 * fires inside `importNode`, before ReactiveRoot assigns `c`), and jsdom
 * matches that ordering. This is an environment difference, not an Ion one.
 *
 * (shelter-ui is CC0-1.0; see THIRD_PARTY.md.)
 */
import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { ReactiveRoot } from "@uwu/shelter-ui";

describe("ReactiveRoot", () => {
  it("renders its children through the custom element", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(() => <ReactiveRoot>root body</ReactiveRoot>, host);

    const root = host.querySelector("shltr-rroot");
    expect(root).not.toBeNull();
    expect(root?.textContent).toBe("root body");

    dispose();
    host.remove();
  });

  it("disposes the rendered tree when the element disconnects", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(() => <ReactiveRoot>to be removed</ReactiveRoot>, host);

    const root = host.querySelector("shltr-rroot");
    expect(root?.textContent).toBe("to be removed");

    root?.remove();
    expect(root?.textContent).toBe("");

    dispose();
    host.remove();
  });

  it("adds no wrapper of its own around the children", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(() => <ReactiveRoot>only child</ReactiveRoot>, host);

    const root = host.querySelector("shltr-rroot");
    expect(root?.children.length).toBe(0);
    expect(host.children.length).toBe(1);

    dispose();
    host.remove();
  });
});
