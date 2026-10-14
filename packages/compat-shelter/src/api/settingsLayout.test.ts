// @vitest-environment jsdom
/**
 * Drawing registered sections into Discord's settings layout tree.
 *
 * What cannot be exercised here is Discord's real tree — that needs a
 * signed-in session (docs/shelter-stage3.md) — so these tests drive the
 * entry point Discord itself drives: reading `buildLayout` off a layout
 * node, which the installed prototype getter answers by patching the root
 * it resolves. They pin the contract Ion controls: what lands in the tree,
 * that the nesting is the shape Discord's renderer dispatches on, that the
 * hook is taken back out when the last section goes, and that a session
 * with no React to render a section with says so instead of half-drawing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReactSurface } from "./react";
import type { SettingsSection } from "./settings";
import { createSettingsLayoutHost } from "./settingsLayout";

/** One built layout node, as the test roots hold them. */
interface FakeNode {
  key?: string;
  layout?: FakeNode[];
  Component?: unknown;
  useTitle?: unknown;
  useSearchTerms?: unknown;
  parent?: unknown;
}

/** A session whose discovery resolved every React object the bridges need. */
const WITH_REACT: ReactSurface = {
  React: {
    createElement: () => null,
    createRef: () => ({ current: null }),
    Component: class {
      constructor(readonly props: Record<string, unknown>) {}
    },
  },
  ReactDOM: {},
  ReactDOMClient: { createRoot: () => ({ render: () => undefined, unmount: () => undefined }) },
};

/** A session whose discovery resolved none of Discord's React objects. */
const NO_REACT: ReactSurface = {
  React: undefined,
  ReactDOM: undefined,
  ReactDOMClient: undefined,
};

const SECTIONS: SettingsSection[] = [
  ["header", "Demo"],
  ["section", "demo.pane", "Demo pane", () => null],
];

/** A root in the shape `topmostLayoutNode` accepts, with nothing built yet. */
function freshRoot(): Record<string, unknown> {
  return { key: "$Root", layout: [] as FakeNode[] };
}

/** Lets the layout hook's microtask run, so a patch has landed. */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The prototype getter, read without firing it. */
function hookInstalled(): boolean {
  return Object.getOwnPropertyDescriptor(Object.prototype, "buildLayout") !== undefined;
}

describe("createSettingsLayoutHost", () => {
  afterEach(() => {
    // A test that leaves the hook installed would patch every later test's
    // roots, so the teardown mirrors what `draw([])` does in production.
    if (hookInstalled()) {
      delete (Object.prototype as Partial<Record<"buildLayout", unknown>>).buildLayout;
    }
  });

  it("patches the built tree with one group per header and rows nested like Discord's", async () => {
    const warn = vi.fn();
    const host = createSettingsLayoutHost({ react: WITH_REACT, doc: document, warn });

    expect(host.draw(SECTIONS)).toBe(true);

    const root = freshRoot();
    expect((root as { buildLayout?: unknown }).buildLayout).toBeUndefined();
    await flush();

    const groups = root["layout"] as FakeNode[];
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group?.key).toBe("shelter_demo_section");
    expect(typeof group?.useTitle).toBe("function");

    // group → sidebar item → panel → category → setting: the chain Discord's
    // layout renderer walks, so a wrong level renders a broken row.
    const item = group?.layout?.[0];
    expect(item?.key).toBe("shelter_demo.pane_sidebar_item");
    const panel = item?.layout?.[0];
    expect(panel?.key).toBe("shelter_demo.pane_panel");
    const category = panel?.layout?.[0];
    expect(category?.key).toBe("shelter_demo.pane_category");
    const setting = category?.layout?.[0];
    expect(setting?.key).toBe("shelter_demo.pane_setting");
    expect(typeof setting?.Component).toBe("function");
    expect(typeof setting?.useSearchTerms).toBe("function");

    // With a stub tree there is no language-and-time panel to steal node
    // types from, so the fallback is used — and said once, not per draw.
    expect(host.draw(SECTIONS)).toBe(true);
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("could not be found");

    host.draw([]);
  });

  it("takes the prototype hook back out when the last section goes", async () => {
    const host = createSettingsLayoutHost({
      react: WITH_REACT,
      doc: document,
      warn: () => undefined,
    });

    host.draw(SECTIONS);
    expect(hookInstalled()).toBe(true);

    host.draw([]);
    expect(hookInstalled()).toBe(false);

    const root = freshRoot();
    expect((root as { buildLayout?: unknown }).buildLayout).toBeUndefined();
    await flush();
    expect(root["layout"]).toEqual([]);
  });

  it("draws nothing and reports it when the session resolved no React", () => {
    const host = createSettingsLayoutHost({
      react: NO_REACT,
      doc: document,
      warn: () => undefined,
    });

    expect(host.draw(SECTIONS)).toBe(false);
    expect(hookInstalled()).toBe(false);
  });
});
