/**
 * Structural discovery of Discord's user-settings modal.
 *
 * Discovery keys on Discord's own stable hooks — the
 * `data-settings-sidebar-item` attribute it renders on every settings entry —
 * and on class-name *substrings* (`contentBody`, `scroller`) rather than the
 * hashed full names, so it survives CSS-module hash churn. Nothing here uses
 * localized strings: no aria-labels, no visible text. Every function takes
 * its document/roots as arguments so the whole layer tests headlessly
 * against a DOM fixture (see fixtures.ts, captured from the real client).
 */

export interface SettingsDom {
  readonly dialog: HTMLElement;
  /** The outer `<ul>` of sections — our tab's cloned section lands here. */
  readonly sidebarSections: HTMLElement;
  /** The inner `<ul>` holding item `<li>`s — where the template lives. */
  readonly sidebarItems: HTMLElement;
  /** Best sidebar item to clone: prefer one without a sub-navigation. */
  readonly templateItem: HTMLElement;
  /** Content container that owns the header and body regions. */
  readonly contentBody: HTMLElement;
  /** The native content scroller — our panel renders inside it when active. */
  readonly scroller: HTMLElement;
  /** The breadcrumb's text element, mutated in place. Null when absent. */
  readonly breadcrumbText: HTMLElement | null;
}

function hasClassSubstring(element: Element, substring: string): boolean {
  return (element.getAttribute("class") ?? "").includes(substring);
}

function findBreadcrumbText(contentBody: HTMLElement): HTMLElement | null {
  const container = contentBody.parentElement;
  if (!container) return null;
  const header = [...container.children].find((child) => hasClassSubstring(child, "contentHeader"));
  return header?.querySelector<HTMLElement>("li [data-text-variant]") ?? null;
}

/**
 * Returns the settings modal's key nodes, or null when no modal (or only a
 * partially rendered one) is present. Callers retry on DOM mutations.
 */
export function findSettingsDom(doc: Document): SettingsDom | null {
  // `:not([data-ion-tab])` keeps our own injected row from ever being
  // mistaken for a Discord template (we prepend it, so it would otherwise
  // be the first match in document order).
  const anchor = doc.querySelector<HTMLElement>(
    "li[data-settings-sidebar-item]:not([data-ion-tab])",
  );
  if (!anchor) return null;

  const sidebarItems = anchor.closest("ul");
  const aside = anchor.closest("aside");
  const dialog = anchor.closest<HTMLElement>("[role=dialog]");
  if (!sidebarItems || !aside || !dialog) return null;

  // item li -> section li -> sections ul (the tab's section is appended here).
  const sidebarSections = sidebarItems.parentElement?.parentElement;
  if (sidebarSections?.tagName !== "UL") return null;

  // The content column sits next to the aside; its header and body nest
  // inside it (`content_{hash} > contentHeader + contentBody`).
  const container = aside.parentElement;
  const contentBody = container?.querySelector<HTMLElement>("[class*=contentBody]") ?? null;
  if (!contentBody) return null;

  const scroller = contentBody.querySelector<HTMLElement>("[class*=scroller]");
  if (!scroller) return null;

  const items = [...sidebarItems.querySelectorAll<HTMLElement>("li[data-settings-sidebar-item]")];
  const templateItem = items.find((item) => !item.querySelector("[class*=subnav]")) ?? items[0];
  if (!templateItem) return null;

  return {
    dialog,
    sidebarSections,
    sidebarItems,
    templateItem,
    contentBody,
    scroller,
    breadcrumbText: findBreadcrumbText(contentBody),
  };
}
