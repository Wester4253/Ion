import type { SettingsDom } from "./modal";

export interface SidebarTab {
  /** The injected `li[data-settings-sidebar-item]`. */
  readonly item: HTMLElement;
  setActive(active: boolean): void;
  destroy(): void;
}

export interface SidebarTabOptions {
  /** Stable id used in `data-settings-sidebar-item` and list-item ids. */
  readonly id: string;
  readonly label: string;
  /** Trusted first-party SVG markup for the row icon. */
  readonly iconSvg: string;
  readonly onSelect: () => void;
}

function isActiveToken(token: string): boolean {
  return token === "active" || token.startsWith("active_") || token.startsWith("active-");
}

/**
 * The hashed active class (`active_caf372`) Discord toggles on the selected
 * row. Captured from whichever row currently carries `aria-current`, so it
 * tracks Discord's build rather than hardcoding a hash.
 */
function findActiveToken(items: HTMLElement): string | undefined {
  const current = items.querySelector<HTMLElement>("[aria-current]");
  if (!current) return undefined;
  return [...current.classList].find(isActiveToken);
}

function parseSvg(doc: Document, markup: string): Element | null {
  const template = doc.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

/**
 * Injects an "Ion" row into the settings sidebar by cloning Discord's own
 * markup: an existing section (heading + list) plus one item row, with the
 * icon, label, ids and active state replaced. Cloning keeps Discord's
 * listeners and styling attached to familiar nodes; React never learns about
 * our nodes, so its renders leave them alone.
 */
export function injectSidebarTab(dom: SettingsDom, options: SidebarTabOptions): SidebarTab {
  const doc = dom.templateItem.ownerDocument;
  const activeToken = findActiveToken(dom.sidebarItems);
  const sectionTemplate = dom.templateItem.parentElement?.parentElement;
  if (!sectionTemplate) {
    throw new Error(`ion: sidebar item ${options.id} has no section wrapper`);
  }

  const section = sectionTemplate.cloneNode(true) as HTMLElement;
  const heading = section.querySelector("h3");
  const list = section.querySelector(":scope > ul");
  if (!heading || !list) {
    throw new Error(`ion: sidebar section template for ${options.id} is malformed`);
  }

  // Unique heading id: the clone would otherwise duplicate the template's.
  const headingId = `${options.id}-heading`;
  heading.id = headingId;
  heading.textContent = options.label;
  section.setAttribute("aria-labelledby", headingId);

  const item = dom.templateItem.cloneNode(true) as HTMLElement;
  item.setAttribute("data-settings-sidebar-item", options.id);
  // Tagged so discovery never mistakes our row for a Discord template.
  item.setAttribute("data-ion-tab", options.id);
  for (const subnav of [...item.querySelectorAll("[class*=subnav]")]) {
    subnav.remove();
  }

  const inner = item.querySelector<HTMLElement>(":scope > [role=link]");
  const content = inner?.firstElementChild;
  if (!inner || !content) {
    throw new Error(`ion: sidebar item template for ${options.id} is malformed`);
  }
  inner.setAttribute("data-list-item-id", `settings-sidebar___${options.id}`);
  for (const token of [...inner.classList]) {
    if (isActiveToken(token)) inner.classList.remove(token);
  }
  inner.removeAttribute("aria-current");

  const label = [...content.children].find((child) => child.tagName === "DIV");
  if (!label) {
    throw new Error(`ion: sidebar item template for ${options.id} has no label`);
  }
  label.textContent = options.label;
  const icon = parseSvg(doc, options.iconSvg);
  content.replaceChildren(...(icon ? [icon, label] : [label]));

  list.replaceChildren(item);
  section.setAttribute("data-ion-tab", options.id);
  // Top of the sidebar, above Discord's own sections — discoverable without
  // scrolling and mirroring how other mods place their settings tab.
  dom.sidebarSections.prepend(section);

  const onClick = (): void => {
    options.onSelect();
  };
  const onKeydown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    options.onSelect();
  };
  inner.addEventListener("click", onClick);
  inner.addEventListener("keydown", onKeydown);

  return {
    item,
    setActive(active: boolean): void {
      if (active) {
        if (activeToken) inner.classList.add(activeToken);
        inner.setAttribute("aria-current", "page");
      } else {
        if (activeToken) inner.classList.remove(activeToken);
        inner.removeAttribute("aria-current");
      }
    },
    destroy(): void {
      inner.removeEventListener("click", onClick);
      inner.removeEventListener("keydown", onKeydown);
      section.remove();
    },
  };
}
