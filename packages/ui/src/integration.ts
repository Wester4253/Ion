import { findSettingsDom, type SettingsDom } from "./modal";
import { injectSidebarTab, type SidebarTab } from "./tab";

export interface IntegrationOptions {
  readonly doc: Document;
  /** Sidebar id for our row, e.g. `ion_panel`. */
  readonly id: string;
  readonly label: string;
  /** Trusted first-party SVG markup for the row icon. */
  readonly iconSvg: string;
  /** Mounts the settings panel into `host`; returns its unmount callback. */
  readonly renderPanel: (host: HTMLElement) => () => void;
}

export interface SettingsIntegration {
  /** True while our sidebar row exists in a live settings modal. */
  readonly mounted: boolean;
  /** True while our panel is the visible settings page. */
  readonly active: boolean;
  /** Reconcile immediately; the mutation observer also calls this. */
  sync(): void;
  /** Full teardown: deactivates, removes listeners and the observer. */
  stop(): void;
}

function isActiveToken(token: string): boolean {
  return token === "active" || token.startsWith("active_") || token.startsWith("active-");
}

interface SavedActive {
  readonly element: HTMLElement;
  readonly tokens: readonly string[];
}

/**
 * Owns the settings-page lifecycle: injects our sidebar row when Discord opens
 * the settings modal, and swaps the content region to our panel when the row
 * is selected — restoring Discord's own state on the way out.
 *
 * The panel renders *inside Discord's native content scroller* while the
 * scroller's own children are hidden. That keeps scrolling, the scrollbar and
 * the column geometry exactly native; we only replace the content.
 *
 * All mutations are *idempotent re-assertions*: Discord re-renders can replace
 * or restyle nodes at any time, so every observer pass re-establishes the
 * desired state instead of assuming it stuck. Every dependency is injected
 * (document, render callback), which is what makes this testable headlessly.
 */
export function startSettingsIntegration(options: IntegrationOptions): SettingsIntegration {
  const { doc } = options;
  let mounted: { dom: SettingsDom; tab: SidebarTab } | null = null;
  let active = false;
  let panelHost: HTMLElement | null = null;
  let unmountPanel: (() => void) | undefined;
  let nativeActive: SavedActive | null = null;
  /** Scroller children hidden while active, mapped to their original display. */
  let hiddenChildren = new Map<HTMLElement, string>();
  let breadcrumb: { readonly element: HTMLElement; readonly original: string } | null = null;

  /** Hides the scroller's Discord content, recording inline displays to restore. */
  function hideScrollerChildren(scroller: HTMLElement): void {
    for (const child of [...scroller.children]) {
      if (child === panelHost) continue;
      const element = child as HTMLElement;
      if (!hiddenChildren.has(element)) {
        hiddenChildren.set(element, element.style.display);
      }
      if (element.style.display !== "none") element.style.display = "none";
    }
    // Drop entries for nodes React has since discarded; they can never restore.
    for (const element of [...hiddenChildren.keys()]) {
      if (!element.isConnected) hiddenChildren.delete(element);
    }
  }

  function activate(): void {
    if (!mounted || active) return;
    const { dom, tab } = mounted;
    active = true;

    // Take the active styling off Discord's own row; we restore it verbatim
    // on deactivate, after which React's own class diff settles the rest.
    const current = dom.sidebarItems.querySelector<HTMLElement>("[aria-current]");
    if (current) {
      const tokens = [...current.classList].filter(isActiveToken);
      for (const token of tokens) current.classList.remove(token);
      current.removeAttribute("aria-current");
      nativeActive = { element: current, tokens };
    }

    tab.setActive(true);

    hideScrollerChildren(dom.scroller);

    if (dom.breadcrumbText) {
      breadcrumb = {
        element: dom.breadcrumbText,
        original: dom.breadcrumbText.textContent,
      };
      dom.breadcrumbText.textContent = options.label;
    }

    panelHost = doc.createElement("ion-settings-panel");
    dom.scroller.append(panelHost);
    // Discord scrolls to the top on every settings navigation; mirror that so
    // our page never inherits the previous page's scroll position.
    dom.scroller.scrollTop = 0;
    unmountPanel = options.renderPanel(panelHost);
  }

  function deactivate(): void {
    if (!active) return;
    active = false;
    mounted?.tab.setActive(false);

    if (nativeActive) {
      const { element, tokens } = nativeActive;
      if (element.isConnected) {
        for (const token of tokens) element.classList.add(token);
        element.setAttribute("aria-current", "page");
      }
      nativeActive = null;
    }
    for (const [element, display] of hiddenChildren) {
      if (element.isConnected) element.style.display = display;
    }
    hiddenChildren = new Map();
    if (breadcrumb) {
      if (breadcrumb.element.isConnected) {
        breadcrumb.element.textContent = breadcrumb.original;
      }
      breadcrumb = null;
    }
    unmountPanel?.();
    unmountPanel = undefined;
    panelHost?.remove();
    panelHost = null;
  }

  function reset(): void {
    deactivate();
    mounted?.tab.destroy();
    mounted = null;
  }

  function mount(dom: SettingsDom): void {
    const tab = injectSidebarTab(dom, {
      id: options.id,
      label: options.label,
      iconSvg: options.iconSvg,
      onSelect: activate,
    });
    mounted = { dom, tab };
  }

  /** Re-assert the active state after a Discord re-render. */
  function reassert(): void {
    if (!mounted || !active) return;
    const { dom } = mounted;

    // Re-hide any content React re-rendered or re-created, and re-adopt the
    // new nodes' displays so deactivate can still restore them.
    hideScrollerChildren(dom.scroller);

    if (dom.breadcrumbText) {
      if (!breadcrumb?.element.isConnected) {
        // React replaced the crumb node: adopt it, capturing its current
        // text as the value to restore on deactivate.
        breadcrumb = {
          element: dom.breadcrumbText,
          original: dom.breadcrumbText.textContent,
        };
      }
      if (dom.breadcrumbText.textContent !== options.label) {
        dom.breadcrumbText.textContent = options.label;
      }
    }

    // React can re-apply the native row's active styling when a settings
    // store re-renders (no childList change, so attribute observation is
    // what gets us here). While our page is up, that row stays inactive.
    const { tab } = mounted;
    for (const row of dom.sidebarItems.querySelectorAll<HTMLElement>("[aria-current]")) {
      if (tab.item.contains(row)) continue;
      for (const token of [...row.classList]) {
        if (isActiveToken(token)) row.classList.remove(token);
      }
      row.removeAttribute("aria-current");
    }

    if (panelHost && panelHost.parentElement !== dom.scroller) {
      dom.scroller.append(panelHost);
    }
  }

  function sync(): void {
    const found = findSettingsDom(doc);
    if (!found) {
      reset();
      return;
    }
    if (!mounted) {
      mount(found);
      return;
    }
    const sidebarRebuilt = mounted.dom.sidebarSections !== found.sidebarSections;
    const contentRebuilt = mounted.dom.contentBody !== found.contentBody;
    if (sidebarRebuilt || contentRebuilt || !mounted.tab.item.isConnected) {
      // Discord rebuilt part of the modal (lazy chunks replace the content
      // region after first open). Remount — and if the user was on our page,
      // put them back on it instead of silently reverting to Discord's page.
      const wasActive = active;
      reset();
      mount(found);
      if (wasActive) activate();
      return;
    }
    // Same modal: refresh element references and re-assert our mutations.
    mounted = { dom: found, tab: mounted.tab };
    reassert();
  }

  const onClick = (event: Event): void => {
    if (!mounted || !(event.target instanceof Element)) return;
    const row = event.target.closest("li[data-settings-sidebar-item]");
    if (!row) return;
    if (row === mounted.tab.item) activate();
    else deactivate();
  };

  // Observe the Document itself: the UI bundle evaluates at document_start,
  // where `document.documentElement` may not exist yet. Fall back to the
  // global observer for detached documents (tests). `aria-current` is watched
  // so React re-applying the native active row is caught without a rebuild.
  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  const observer = new Observer(sync);
  observer.observe(doc, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-current"],
  });
  doc.addEventListener("click", onClick, true);
  sync();

  return {
    get mounted(): boolean {
      return mounted !== null;
    },
    get active(): boolean {
      return active;
    },
    sync,
    stop(): void {
      reset();
      observer.disconnect();
      doc.removeEventListener("click", onClick, true);
    },
  };
}
