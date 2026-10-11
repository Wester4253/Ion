// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { findSettingsDom } from "./modal";
import { SETTINGS_MODAL_HTML } from "./fixtures";

function openSettings(): Document {
  const doc = document.implementation.createHTMLDocument("test");
  doc.body.innerHTML = SETTINGS_MODAL_HTML;
  return doc;
}

describe("findSettingsDom", () => {
  it("returns null when no settings modal exists", () => {
    const doc = document.implementation.createHTMLDocument("test");
    expect(findSettingsDom(doc)).toBeNull();
  });

  it("finds every node the integration needs", () => {
    const dom = findSettingsDom(openSettings());
    expect(dom).not.toBeNull();
    expect(dom?.dialog.getAttribute("role")).toBe("dialog");
    expect(dom?.sidebarSections.tagName).toBe("UL");
    expect(dom?.sidebarSections.classList.contains("sublist__409aa")).toBe(true);
    expect(dom?.sidebarItems.tagName).toBe("UL");
    expect(dom?.contentBody.classList.contains("contentBody_e9e3ed")).toBe(true);
    expect(dom?.scroller.classList.contains("scroller__6131a")).toBe(true);
    expect(dom?.breadcrumbText?.textContent).toBe("Account");
  });

  it("prefers a template item without a sub-navigation", () => {
    const dom = findSettingsDom(openSettings());
    expect(dom?.templateItem.getAttribute("data-settings-sidebar-item")).toBe("account_panel");
    expect(dom?.templateItem.querySelector("[class*=subnav]")).toBeNull();
  });

  it("works when the breadcrumb header is absent", () => {
    const doc = openSettings();
    doc.querySelector(".contentHeader_e9e3ed")?.remove();
    const dom = findSettingsDom(doc);
    expect(dom).not.toBeNull();
    expect(dom?.breadcrumbText).toBeNull();
  });

  it("returns null for a partially rendered modal", () => {
    const doc = document.implementation.createHTMLDocument("test");
    doc.body.innerHTML = `<div role="dialog"><li data-settings-sidebar-item="account_panel"></li></div>`;
    // No aside/content yet.
    expect(findSettingsDom(doc)).toBeNull();
  });
});
