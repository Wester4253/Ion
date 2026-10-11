// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { findSettingsDom } from "./modal";
import { injectSidebarTab } from "./tab";
import { SETTINGS_MODAL_HTML, TEST_ICON_SVG } from "./fixtures";

function setup(): ReturnType<typeof findSettingsDom> {
  const doc = document.implementation.createHTMLDocument("test");
  doc.body.innerHTML = SETTINGS_MODAL_HTML;
  return findSettingsDom(doc);
}

function ourRow(dom: NonNullable<ReturnType<typeof findSettingsDom>>): HTMLElement | null {
  // Our row lives in the injected section at the end of the sections list.
  return dom.sidebarSections.querySelector('li[data-settings-sidebar-item="ion_panel"]');
}

describe("injectSidebarTab", () => {
  it("prepends a dedicated section with a single cloned row", () => {
    const dom = setup();
    expect(dom).not.toBeNull();
    if (!dom) return;

    const tab = injectSidebarTab(dom, {
      id: "ion_panel",
      label: "Ion",
      iconSvg: TEST_ICON_SVG,
      onSelect: () => undefined,
    });

    const sections = dom.sidebarSections.querySelectorAll(":scope > li");
    expect(sections).toHaveLength(3);
    const ownSection = sections[0];
    if (!ownSection) throw new Error("expected a first section");
    expect(ownSection.getAttribute("data-ion-tab")).toBe("ion_panel");
    expect(ownSection.querySelector("ul")?.children).toHaveLength(1);
    expect(ourRow(dom)).toBe(tab.item);
    tab.destroy();
    expect(ourRow(dom)).toBeNull();
    expect(dom.sidebarSections.querySelectorAll(":scope > li")).toHaveLength(2);
  });

  it("replaces label, icon, ids and heading ids", () => {
    const dom = setup();
    if (!dom) throw new Error("fixture did not parse");

    injectSidebarTab(dom, {
      id: "ion_panel",
      label: "Ion",
      iconSvg: TEST_ICON_SVG,
      onSelect: () => undefined,
    });

    const item = ourRow(dom);
    expect(item).not.toBeNull();
    if (!item) return;
    const inner = item.querySelector<HTMLElement>(":scope > [role=link]");
    expect(inner?.getAttribute("data-list-item-id")).toBe("settings-sidebar___ion_panel");
    expect(item.querySelector("[data-text-variant]")?.textContent).toBe("Ion");

    // Icon swapped to ours (fixture icon has no "M1 1" path).
    expect(item.querySelector("svg path")?.getAttribute("d")).toBe("M1 1h18v18H1z");

    // Heading must not duplicate the template's id, and section must point at it.
    const section = dom.sidebarSections.querySelector("[data-ion-tab]");
    const heading = section?.querySelector("h3");
    expect(heading?.id).toBe("ion_panel-heading");
    expect(heading?.textContent).toBe("Ion");
    expect(section?.getAttribute("aria-labelledby")).toBe("ion_panel-heading");
    const ids = [...dom.sidebarSections.querySelectorAll("h3")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("strips the active styling inherited from the template row", () => {
    const dom = setup();
    if (!dom) throw new Error("fixture did not parse");

    const tab = injectSidebarTab(dom, {
      id: "ion_panel",
      label: "Ion",
      iconSvg: TEST_ICON_SVG,
      onSelect: () => undefined,
    });
    const inner = tab.item.querySelector<HTMLElement>(":scope > [role=link]");
    expect(inner?.classList.contains("active_caf372")).toBe(false);
    expect(inner?.hasAttribute("aria-current")).toBe(false);
  });

  it("toggles the hashed active class and aria-current", () => {
    const dom = setup();
    if (!dom) throw new Error("fixture did not parse");

    const tab = injectSidebarTab(dom, {
      id: "ion_panel",
      label: "Ion",
      iconSvg: TEST_ICON_SVG,
      onSelect: () => undefined,
    });
    const inner = tab.item.querySelector<HTMLElement>(":scope > [role=link]");
    expect(inner).not.toBeNull();
    if (!inner) return;

    tab.setActive(true);
    expect(inner.classList.contains("active_caf372")).toBe(true);
    expect(inner.getAttribute("aria-current")).toBe("page");

    tab.setActive(false);
    expect(inner.classList.contains("active_caf372")).toBe(false);
    expect(inner.hasAttribute("aria-current")).toBe(false);
  });

  it("fires onSelect for click, Enter and Space — and nothing else", () => {
    const dom = setup();
    if (!dom) throw new Error("fixture did not parse");

    const onSelect = vi.fn();
    const tab = injectSidebarTab(dom, {
      id: "ion_panel",
      label: "Ion",
      iconSvg: TEST_ICON_SVG,
      onSelect,
    });
    const inner = tab.item.querySelector<HTMLElement>(":scope > [role=link]");
    if (!inner) throw new Error("injected row lost its inner element");

    inner.click();
    expect(onSelect).toHaveBeenCalledTimes(1);

    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    inner.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(3);

    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(3);

    tab.destroy();
    inner.click();
    expect(onSelect).toHaveBeenCalledTimes(3);
  });
});
