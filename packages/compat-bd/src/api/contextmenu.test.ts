// @vitest-environment happy-dom
/**
 * Unit tests for the `BdApi.ContextMenu` surface: the startup retry
 * contract (patches register while Discord's menu modules are missing and
 * arm once they load), the dispatcher-interceptor patch flow for lazy and
 * direct renders, glob/regex patch targeting, failure isolation, and the
 * menu builders (`buildItem`/`buildMenuChildren`/`buildMenu`).
 *
 * `startupState` is module-level, so the pending-startup test runs before
 * any fixture is installed.
 */

// These tests pin the warnings and errors the ContextMenu surface logs,
// because the compat harness attributes plugin failures by reading them
// back off the `console-message` event. Referencing the spied methods is
// the point.
/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonDiscoveryApi, IonGlobal } from "@ion/core";

import { BdApi } from "../api/index";
import { ContextMenu, MenuPatcher, type MenuRenderProps } from "./contextmenu";

const ELEMENT = Symbol.for("react.element");

interface FakeElement {
  $$typeof: symbol;
  type: unknown;
  props: Record<string, unknown>;
}

interface FakeReact {
  Component: unknown;
  createElement(type: unknown, props?: object | null, ...children: unknown[]): FakeElement;
  cloneElement(element: unknown, props?: object | null): FakeElement;
  isValidElement(value: unknown): boolean;
  useState<T>(initial: T | (() => T)): [state: T, setState: () => undefined];
}

const fakeReact: FakeReact = {
  Component: class Component {
    state: Record<string, unknown> = {};
  },
  createElement: (type, props, ...children) => ({
    $$typeof: ELEMENT,
    type,
    props: {
      ...((props ?? {}) as Record<string, unknown>),
      ...(children.length > 0 ? { children: children.length === 1 ? children[0] : children } : {}),
    },
  }),
  cloneElement: (element, props) => {
    const source = element as FakeElement;
    return {
      $$typeof: source.$$typeof,
      type: source.type,
      props: { ...source.props, ...(props ?? {}) },
    };
  },
  isValidElement: (value) => typeof value === "object" && value !== null && "$$typeof" in value,
  useState: (initial) => [
    typeof initial === "function" ? (initial as () => never)() : initial,
    () => undefined,
  ],
};

const menuComponents = {
  MenuItem: { component: "Item" },
  Menu: { component: "Menu" },
  MenuSeparator: { component: "Separator" },
  MenuGroup: { component: "Group" },
  MenuCheckboxItem: { component: "CheckboxItem" },
  MenuRadioItem: { component: "RadioItem" },
  MenuControlItem: { component: "ControlItem" },
};

interface OpenCall {
  event: MouseEvent;
  render: (props: MenuRenderProps) => unknown;
  config?: unknown;
}

const openCalls: OpenCall[] = [];
let closeCalls = 0;
/**
 * Last discovery token a fake Discord action touched. The tokens must live
 * in a side-effecting statement: bare `void "…"` statements are pure and get
 * dropped by the transpiler, which strips them from `String(fn)` and breaks
 * `byStrings` discovery.
 */
let lastActionToken = "";

const closeContextMenu = (): void => {
  lastActionToken = "CONTEXT_MENU_CLOSE";
  closeCalls++;
};

const openContextMenu = (
  event: MouseEvent,
  render: (props: MenuRenderProps) => unknown,
  config?: unknown,
): void => {
  lastActionToken = "renderLazy";
  openCalls.push({ event, render, config });
};

function actionsFactory(): Record<string, unknown> {
  // Mirrors Discord's real module, whose factory text carries both
  // bySource tokens in one body — literals, not comments.
  const tokens = "new DOMRect CONTEXT_MENU_CLOSE";
  return { tokens, closeContextMenu, openContextMenu };
}

type Interceptor = (event: { type: string; [key: string]: unknown }) => void;
let interceptor: Interceptor | undefined;

let findable: unknown[];
let requires: object[];

interface FakeRequire {
  (id: PropertyKey): unknown;
  c: Record<string, { id: string; loaded: boolean; exports: unknown }>;
  m: Record<PropertyKey, unknown>;
}

function makeRequire(
  modules: Record<string, unknown>,
  factories: Record<string, unknown>,
): FakeRequire {
  return Object.assign((id: PropertyKey) => modules[String(id)], {
    c: Object.fromEntries(
      Object.entries(modules).map(([id, exports]) => [id, { id, loaded: true, exports }]),
    ),
    m: factories,
  });
}

beforeEach(() => {
  findable = [];
  requires = [];
  MenuPatcher.patches = { named: {}, regex: [] };
  const discovery = {
    find: (filter: (exports: unknown) => boolean) => {
      for (const candidate of findable) {
        if (candidate === null || candidate === undefined) continue;
        if (filter(candidate)) return candidate;
      }
      return undefined;
    },
    getRequires: () => requires,
    waitFor: () => () => undefined,
  } as unknown as IonDiscoveryApi;
  (window as unknown as { __ION__: IonGlobal }).__ION__ = { discovery } as unknown as IonGlobal;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Discord's React plus the Flux dispatcher with the interceptor hook. */
function installDiscordModules(): void {
  const dispatcher = {
    dispatch: () => undefined,
    subscribe: () => undefined,
    register: () => undefined,
    addInterceptor: (listener: Interceptor) => {
      interceptor = listener;
      return "interceptor-id";
    },
  };
  findable.push(fakeReact, dispatcher);
}

describe("startup retry", () => {
  it("registers patches while startup is pending and warns", () => {
    const api = new ContextMenu();
    const callback = vi.fn();
    const dispose = api.patch("user-profile", callback);

    expect(console.warn).toHaveBeenCalled();
    // Nothing to intercept yet: the interceptor never armed.
    expect(interceptor).toBeUndefined();

    // The patch is registered, and disposal works even while pending.
    expect(MenuPatcher.patches.named["user-profile"]?.has(callback)).toBe(true);
    dispose();
    expect(MenuPatcher.patches.named["user-profile"]).toBeUndefined();
  });
});

describe("with Discord's menu modules present", () => {
  beforeEach(() => {
    installDiscordModules();
    requires.push(
      makeRequire(
        { "menu-components": menuComponents, actions: { closeContextMenu, openContextMenu } },
        { "menu-components": () => menuComponents, actions: actionsFactory },
      ),
    );
  });

  /** Arms the API (first patch call runs startup) and returns the api. */
  function prime(): ContextMenu {
    const api = new ContextMenu();
    api.patch("prime-once", () => undefined);
    return api;
  }

  async function openMenu(
    renderProps: Record<string, unknown>,
    render?: (props: Record<string, unknown>) => unknown,
  ): Promise<unknown> {
    const contextMenuObject: Record<string, unknown> = {
      config: {},
      renderLazy: () =>
        Promise.resolve(
          render ??
            ((props: Record<string, unknown>) =>
              fakeReact.createElement("div", { navId: props["navId"] })),
        ),
    };
    interceptor?.({ type: "CONTEXT_MENU_OPEN", contextMenu: contextMenuObject });
    const wrapped = (await (contextMenuObject["renderLazy"] as () => Promise<unknown>)()) as (
      props: Record<string, unknown>,
    ) => unknown;
    return wrapped(renderProps);
  }

  it("arms the dispatcher interceptor and runs named patches for the menu id", async () => {
    const api = prime();
    expect(interceptor).toBeTypeOf("function");

    const callback = vi.fn<(element: unknown, props: unknown, instance?: unknown) => void>();
    api.patch("user-profile", callback);
    await openMenu({ navId: "user-profile", config: {} });

    expect(callback).toHaveBeenCalledOnce();
    const [element, props] = callback.mock.calls[0] ?? [];
    expect((element as { props: Record<string, unknown> }).props["navId"]).toBe("user-profile");
    expect((props as Record<string, unknown>)["navId"]).toBe("user-profile");
  });

  it("patches menus opened through the direct render path", () => {
    const api = prime();
    const callback = vi.fn();
    api.patch("direct-menu", callback);

    const contextMenuObject: Record<string, unknown> = {
      config: {},
      render: (props: Record<string, unknown>) =>
        fakeReact.createElement("div", { navId: props["navId"] }),
    };
    interceptor?.({ type: "CONTEXT_MENU_OPEN", contextMenu: contextMenuObject });
    const wrapped = contextMenuObject["render"] as (props: Record<string, unknown>) => unknown;
    wrapped({ navId: "direct-menu" });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("targets glob and regex patches, and unpatch stops the callback", async () => {
    const api = prime();
    const globCallback = vi.fn();
    const regexCallback = vi.fn();
    api.patch("guild-*", globCallback);
    api.patch(/^user-/, regexCallback);

    await openMenu({ navId: "guild-123" });
    expect(globCallback).toHaveBeenCalledOnce();
    expect(regexCallback).not.toHaveBeenCalled();

    await openMenu({ navId: "user-456" });
    expect(regexCallback).toHaveBeenCalledOnce();
    expect(globCallback).toHaveBeenCalledOnce();

    // Disposing the unpatchers removes both targets.
    MenuPatcher.unpatch("guild-*", globCallback);
    MenuPatcher.unpatch(/^user-/, regexCallback);
    await openMenu({ navId: "guild-789" });
    expect(globCallback).toHaveBeenCalledOnce();
    expect(MenuPatcher.patches.regex).toHaveLength(0);
  });

  it("patches into child menu layers when the outer tree has no navId", async () => {
    const api = prime();
    const callback = vi.fn();
    api.patch("child-menu", callback);

    const render = (): unknown => {
      const Layer = (): unknown => fakeReact.createElement("div", { navId: "child-menu" });
      return fakeReact.createElement(Layer, {});
    };
    const outer = (await openMenu({}, render)) as { type: (props: unknown) => unknown };
    // The outer element's component type was patched in place; rendering it
    // produces the child menu, which the recursive patcher reaches.
    expect(typeof outer.type).toBe("function");
    outer.type({});
    expect(callback).toHaveBeenCalledOnce();
  });

  it("isolates a throwing patch from the rest", async () => {
    const api = prime();
    const healthy = vi.fn();
    api.patch("menu-1", () => {
      throw new Error("patch boom");
    });
    api.patch("menu-1", healthy);

    await openMenu({ navId: "menu-1" });
    expect(healthy).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalled();
  });

  it("builds items with upstream prop shapes", () => {
    const api = prime();

    const item = api.buildItem({ label: "Hello" }) as {
      type: unknown;
      props: Record<string, unknown>;
    };
    expect(item.type).toBe(menuComponents.MenuItem);
    expect(item.props["id"]).toBe("Hello");
    expect(item.props["extended"]).toBe(true);

    const onClick = vi.fn();
    const danger = api.buildItem({ label: "Remove", danger: true, onClick }) as {
      props: Record<string, unknown>;
    };
    expect(danger.props["color"]).toBe("danger");
    (danger.props["action"] as (event: unknown) => void)({ type: "click" });
    expect(onClick).toHaveBeenCalledOnce();

    const separator = api.buildItem({ type: "separator" }) as { type: unknown };
    expect(separator.type).toBe(menuComponents.MenuSeparator);

    const group = api.buildItem({
      type: "group",
      label: "Group",
      items: [{ label: "Inside" }],
    }) as { type: unknown; props: Record<string, unknown> };
    expect(group.type).toBe(menuComponents.MenuGroup);
    expect((group.props["children"] as unknown[]).length).toBe(1);
  });

  it("maps toggles onto the checkbox component", () => {
    const api = prime();
    const action = vi.fn();
    const toggle = api.buildItem({
      type: "toggle",
      label: "Enabled",
      checked: true,
      action,
    }) as { type: unknown; props: Record<string, unknown> };
    expect(toggle.type).toBe(menuComponents.MenuCheckboxItem);
    // `active` maps onto `checked` for older plugins.
    expect(toggle.props["checked"]).toBe(true);

    const wrappedAction = toggle.props["action"] as (event: unknown) => void;
    wrappedAction({ type: "click" });
    expect(action).toHaveBeenCalledOnce();

    const active = api.buildItem({ type: "radio", label: "R", active: true }) as {
      type: unknown;
      props: Record<string, unknown>;
    };
    expect(active.type).toBe(menuComponents.MenuRadioItem);
    expect(active.props["checked"]).toBe(true);
  });

  it("builds submenu children from items or render", () => {
    const api = prime();
    const fromItems = api.buildItem({
      type: "submenu",
      label: "Sub",
      items: [{ label: "One" }, { label: "Two" }],
    }) as { props: Record<string, unknown> };
    expect((fromItems.props["children"] as unknown[]).length).toBe(2);

    const fromRender = api.buildItem({
      type: "submenu",
      label: "Sub2",
      render: [{ label: "Three" }],
    }) as { props: Record<string, unknown> };
    expect((fromRender.props["children"] as unknown[]).length).toBe(1);
  });

  it("builds menu children and whole menus", () => {
    const api = prime();
    const children = api.buildMenuChildren([
      { type: "group", items: [{ label: "A" }] },
      { label: "B" },
    ]);
    expect(children).toHaveLength(2);

    const render = api.buildMenu([{ label: "Root" }]);
    const menu = render({ navId: "built", config: {} } as unknown as MenuRenderProps) as {
      type: unknown;
      props: Record<string, unknown>;
    };
    expect(menu.type).toBe(menuComponents.Menu);
    expect(menu.props["navId"]).toBe("built");
  });

  it("exposes Discord's components and drives open/close", () => {
    const api = prime();
    expect(api.Item).toBe(menuComponents.MenuItem);
    expect(api.Group).toBe(menuComponents.MenuGroup);
    expect(api.Separator).toBe(menuComponents.MenuSeparator);
    expect(api.CheckboxItem).toBe(menuComponents.MenuCheckboxItem);
    expect(api.RadioItem).toBe(menuComponents.MenuRadioItem);
    expect(api.ControlItem).toBe(menuComponents.MenuControlItem);
    expect(api.Menu).toBe(menuComponents.Menu);

    const event = new MouseEvent("click");
    const menuComponent = (): unknown => null;
    api.open(event, menuComponent, { position: "right" });
    // The open routed through Discord's own openContextMenu export.
    expect(lastActionToken).toBe("renderLazy");
    expect(openCalls).toHaveLength(1);
    expect(openCalls[0]?.event).toBe(event);
    expect(openCalls[0]?.config).toEqual({ position: "right" });
    // The render callback composes the caller's menu with Discord's onClose.
    const composed = openCalls[0]?.render({
      navId: "x",
      config: {},
    } as unknown as MenuRenderProps) as { props: Record<string, unknown> };
    expect(composed.props["onClose"]).toBe(closeContextMenu);

    api.close();
    expect(closeCalls).toBe(1);
    expect(lastActionToken).toBe("CONTEXT_MENU_CLOSE");
  });

  it("publishes the same instance and scoped hooks through BdApi", () => {
    prime();
    expect(BdApi.ContextMenu).toBeInstanceOf(ContextMenu);
    expect(BdApi.ContextMenu).toBe(new BdApi("AnyPlugin").ContextMenu);
  });
});
