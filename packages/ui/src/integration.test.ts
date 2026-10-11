// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { startSettingsIntegration, type IntegrationOptions } from "./integration";
import { SETTINGS_MODAL_HTML, TEST_ICON_SVG } from "./fixtures";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Stopped even when an assertion fails, so listeners never leak across tests. */
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  document.body.innerHTML = "";
});

interface Harness {
  readonly doc: Document;
  readonly options: IntegrationOptions;
  readonly unmount: ReturnType<typeof vi.fn>;
  readonly renderedHosts: HTMLElement[];
  readonly integration: ReturnType<typeof startSettingsIntegration>;
}

function harness(): Harness {
  const doc = document;
  doc.body.innerHTML = "";
  const renderedHosts: HTMLElement[] = [];
  const unmount = vi.fn((): void => undefined);
  const options: IntegrationOptions = {
    doc,
    id: "ion_panel",
    label: "Ion",
    iconSvg: TEST_ICON_SVG,
    renderPanel: (host) => {
      renderedHosts.push(host);
      host.setAttribute("data-rendered", "true");
      return () => {
        unmount();
      };
    },
  };
  const integration = startSettingsIntegration(options);
  cleanups.push(() => {
    integration.stop();
  });
  return { doc, options, unmount, renderedHosts, integration };
}

function openSettings(doc: Document): void {
  doc.body.innerHTML = SETTINGS_MODAL_HTML;
}

function ourRow(doc: Document): HTMLElement | null {
  return doc.querySelector('li[data-settings-sidebar-item="ion_panel"]');
}

function nativeRow(doc: Document, id: string): HTMLElement | null {
  return doc.querySelector(`li[data-settings-sidebar-item="${id}"]`);
}

/** The breadcrumb crumb text — scoped so sidebar labels don't match first. */
function crumb(doc: Document): HTMLElement | null {
  return doc.querySelector("[class*=contentHeader] [data-text-variant]");
}

async function flush(): Promise<void> {
  await tick();
  await tick();
}

describe("startSettingsIntegration", () => {
  it("mounts the sidebar row when the modal opens", async () => {
    const { doc, integration } = harness();
    expect(integration.mounted).toBe(false);

    openSettings(doc);
    await flush();
    expect(integration.mounted).toBe(true);
    expect(ourRow(doc)).not.toBeNull();

    integration.stop();
  });

  it("activates on our row: hides native content, swaps breadcrumb, renders panel", async () => {
    const { doc, renderedHosts, integration } = harness();
    openSettings(doc);
    await flush();

    ourRow(doc)?.querySelector<HTMLElement>("[role=link]")?.click();
    expect(integration.active).toBe(true);

    const scroller = doc.querySelector<HTMLElement>("[class*=scroller]");
    expect(scroller?.style.display).toBe("none");

    const crumbText = crumb(doc);
    expect(crumbText?.textContent).toBe("Ion");

    // Native active row lost its styling; ours gained it.
    const native = nativeRow(doc, "account_panel")?.querySelector<HTMLElement>("[role=link]");
    expect(native?.classList.contains("active_caf372")).toBe(false);
    expect(native?.hasAttribute("aria-current")).toBe(false);
    const ours = ourRow(doc)?.querySelector<HTMLElement>("[role=link]");
    expect(ours?.classList.contains("active_caf372")).toBe(true);
    expect(ours?.getAttribute("aria-current")).toBe("page");

    const host = doc.querySelector<HTMLElement>("ion-settings-panel");
    expect(host?.isConnected).toBe(true);
    expect(host?.getAttribute("data-rendered")).toBe("true");
    expect(renderedHosts).toHaveLength(1);

    integration.stop();
  });

  it("deactivates on a native row click and restores Discord's state", async () => {
    const { doc, unmount, integration } = harness();
    openSettings(doc);
    await flush();
    ourRow(doc)?.querySelector<HTMLElement>("[role=link]")?.click();
    expect(integration.active).toBe(true);

    nativeRow(doc, "profile_panel")?.querySelector<HTMLElement>("[role=link]")?.click();
    await flush();

    expect(integration.active).toBe(false);
    const scroller = doc.querySelector<HTMLElement>("[class*=scroller]");
    expect(scroller?.style.display).toBe("");
    expect(crumb(doc)?.textContent).toBe("Account");

    const native = nativeRow(doc, "account_panel")?.querySelector<HTMLElement>("[role=link]");
    expect(native?.classList.contains("active_caf372")).toBe(true);
    expect(native?.getAttribute("aria-current")).toBe("page");
    expect(doc.querySelector("ion-settings-panel")).toBeNull();
    expect(unmount).toHaveBeenCalledTimes(1);

    integration.stop();
  });

  it("re-asserts state after Discord replaces nodes while active", async () => {
    const { doc, integration } = harness();
    openSettings(doc);
    await flush();
    ourRow(doc)?.querySelector<HTMLElement>("[role=link]")?.click();
    expect(integration.active).toBe(true);

    // Simulate a React re-render swapping the scroller and removing our host.
    const body = doc.querySelector<HTMLElement>("[class*=contentBody]");
    const freshScroller = doc.createElement("div");
    freshScroller.className = "scroller__6131a";
    doc.querySelector("[class*=scroller]")?.remove();
    body?.prepend(freshScroller);
    doc.querySelector("ion-settings-panel")?.remove();
    await flush();

    expect(integration.active).toBe(true);
    expect(freshScroller.style.display).toBe("none");
    expect(doc.querySelector("ion-settings-panel")?.isConnected).toBe(true);

    integration.stop();
  });

  it("cleans up when the modal closes and stops reacting afterwards", async () => {
    const { doc, unmount, integration } = harness();
    openSettings(doc);
    await flush();
    ourRow(doc)?.querySelector<HTMLElement>("[role=link]")?.click();

    doc.body.innerHTML = "";
    await flush();
    expect(integration.mounted).toBe(false);
    expect(integration.active).toBe(false);
    expect(unmount).toHaveBeenCalledTimes(1);

    // After stop(), new modals are ignored entirely.
    integration.stop();
    openSettings(doc);
    await flush();
    expect(integration.mounted).toBe(false);
    expect(ourRow(doc)).toBeNull();
  });

  it("remounts a fresh row if React evicts ours", async () => {
    const { doc, integration } = harness();
    openSettings(doc);
    await flush();

    ourRow(doc)?.closest("li[data-ion-tab]")?.remove();
    await flush();
    expect(integration.mounted).toBe(true);
    expect(ourRow(doc)).not.toBeNull();

    integration.stop();
  });

  it("re-activates after Discord rebuilds the content region while active", async () => {
    const { doc, renderedHosts, integration } = harness();
    openSettings(doc);
    await flush();
    ourRow(doc)?.querySelector<HTMLElement>("[role=link]")?.click();
    expect(integration.active).toBe(true);

    // Simulate a lazy chunk replacing the whole content column.
    const content = doc.querySelector<HTMLElement>(".content_e9e3ed");
    const fresh = doc.createElement("div");
    fresh.className = "content_e9e3ed rebuilt";
    fresh.innerHTML = `<div class="contentHeader_e9e3ed"><nav><div role="list"><li><div><div data-text-variant="t">Account</div></div></li></div></nav></div>
      <div class="contentBody_e9e3ed"><div class="scroller__6131a"></div></div>`;
    content?.replaceWith(fresh);
    await flush();

    expect(integration.active).toBe(true);
    const newScroller = fresh.querySelector<HTMLElement>("[class*=scroller]");
    expect(newScroller?.style.display).toBe("none");
    expect(fresh.querySelector("ion-settings-panel")).not.toBeNull();
    expect(renderedHosts.length).toBeGreaterThan(1);

    integration.stop();
  });

  it("strips native active styling that React re-applies while active", async () => {
    const { doc, integration } = harness();
    openSettings(doc);
    await flush();
    ourRow(doc)?.querySelector<HTMLElement>("[role=link]")?.click();
    expect(integration.active).toBe(true);

    // Simulate React's store-driven re-render restoring the native row.
    const native = nativeRow(doc, "account_panel")?.querySelector<HTMLElement>("[role=link]");
    if (!native) throw new Error("fixture row missing");
    native.classList.add("active_caf372");
    native.setAttribute("aria-current", "page");
    await flush();

    expect(native.classList.contains("active_caf372")).toBe(false);
    expect(native.hasAttribute("aria-current")).toBe(false);

    integration.stop();
  });

  it("survives starting before the document element exists", async () => {
    // The UI bundle evaluates at document_start, where documentElement can
    // still be null; observing must not throw and must catch later renders.
    const doc = document.implementation.createHTMLDocument("test");
    const html = doc.documentElement;
    html.remove();
    const integration = startSettingsIntegration({
      doc,
      id: "ion_panel",
      label: "Ion",
      iconSvg: TEST_ICON_SVG,
      renderPanel: () => () => undefined,
    });
    cleanups.push(() => {
      integration.stop();
    });
    doc.append(html);
    doc.body.innerHTML = SETTINGS_MODAL_HTML;
    await flush();
    expect(integration.mounted).toBe(true);
  });
});
