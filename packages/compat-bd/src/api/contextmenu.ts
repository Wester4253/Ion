/**
 * `BdApi.ContextMenu` — patching and building Discord context menus. A
 * behavioral port of BetterDiscord's src/betterdiscord/api/contextmenu.ts
 * (Apache-2.0, see THIRD_PARTY.md): patches register by `navId` (string,
 * glob, or regex) and run against the React tree when a menu opens —
 * through Discord's own dispatcher interceptor — plus the menu-building
 * helpers (`buildItem`, `buildMenuChildren`, `buildMenu`, `open`, `close`).
 *
 * Upstream performs its discovery at import time; Ion's bundle evaluates
 * before Discord's webpack runtime exists, so discovery runs lazily on
 * first use. A failed startup degrades exactly like upstream's
 * `startupComplete = false`: patches register but never run, builds warn
 * and return nothing, and the client keeps working. Discovery retries on
 * the next call, since a miss may just mean the menu chunk had not
 * downloaded yet.
 */

import { Logger } from "../common/logger";
import { discovery } from "../host";
import { DOMManager } from "../modules/dommanager";
import {
  getDispatcher,
  loadedReact,
  type BdReact,
  type BdReactElement,
} from "../modules/discord-modules";
import { NodePatcher } from "../modules/nodepatcher";
import { byKeys, bySource, byStrings } from "./webpack/filters";
import { getModule, waitForModule } from "./webpack/search";

export type MenuItemColor =
  "default" | "brand" | "danger" | "premium" | "premium-gradient" | "success";

/** Props common to every menu item this API builds. */
export interface BaseMenuItemProps {
  /** Unique id; derived from the label when omitted. */
  id?: string;
  /** Text (or renderable) shown on the item. */
  label?: unknown;
  /** Item color; `danger` maps onto it for older plugins. */
  color?: MenuItemColor;
  disabled?: boolean;
  className?: string;
  /** Runs on click. */
  action?: (event: unknown) => void;
  /** Older-plugin alias for {@link action}. */
  onClick?: (event: unknown) => void;
  /** Render-prop form for custom items; for submenus, the children list. */
  render?: unknown;
  [key: string]: unknown;
}

/** A submenu item. */
export interface SubmenuItem extends BaseMenuItemProps {
  type: "submenu";
  items?: MenuItem[];
  /** Rendered as the submenu's children when present, as upstream does. */
  render?: MenuItem[];
  /** Built child elements, populated by `buildItem` when omitted. */
  children?: unknown[];
  danger?: boolean;
}

/** A standard item. */
export interface DefaultItem extends BaseMenuItemProps {
  type?: "item";
  danger?: boolean;
}

/** A checkable item. */
export interface CheckboxItem extends BaseMenuItemProps {
  type: "toggle";
  /** Current state; `active` is the older alias. */
  checked?: boolean;
  active?: boolean;
  danger?: boolean;
}

/** A radio item within a group. */
export interface RadioItem extends BaseMenuItemProps {
  type: "radio";
  checked?: boolean;
  active?: boolean;
  group?: string;
  danger?: boolean;
}

/** A custom control item. */
export interface ControlItem extends BaseMenuItemProps {
  type: "control";
  control?: (props: unknown, ref: { ref: unknown }) => unknown;
}

/** A visual separator. */
export interface SeparatorItem {
  type: "separator";
}

/** A labeled group of items. */
export interface GroupItem {
  type: "group";
  label?: unknown;
  items: MenuItem[];
}

export type MenuItem =
  SubmenuItem | DefaultItem | CheckboxItem | RadioItem | ControlItem | SeparatorItem | GroupItem;

export interface MenuConfig {
  position?: "right" | "left";
  align?: "top" | "bottom";
  onClose?(): void;
}

export interface MenuRenderProps {
  config: MenuConfig & { context: "APP" };
  context: "APP";
  onHeightUpdate: () => void;
  position: "right" | "left";
  target: Element;
  theme: string;
}

/** A patch callback: receives the menu's React tree, props, and instance. */
export type PatchCallback = (
  res: BdReactElement,
  props: MenuRenderProps,
  instance?: Record<string, unknown>,
) => void;

/** Discord's menu components, resolved at startup. */
interface MenuComponentsShape {
  Separator?: unknown;
  CheckboxItem?: unknown;
  RadioItem?: unknown;
  ControlItem?: unknown;
  Group?: unknown;
  Item?: unknown;
  Menu?: unknown;
}

interface ContextMenuObject {
  config: MenuConfig;
  render?: (props: MenuRenderProps) => unknown;
  renderLazy?: () => Promise<(props: MenuRenderProps) => unknown>;
}

const menuComponents: MenuComponentsShape = {};
const contextMenuActions: {
  closeContextMenu?: () => void;
  openContextMenu?: (
    event: MouseEvent,
    render: (props: MenuRenderProps) => unknown,
    config?: MenuConfig,
  ) => void;
} = {};

/** `pending`: retry on next call (the miss may be a not-yet-loaded chunk). */
let startupState: "pending" | "ready" | "failed" = "pending";

// Fallback extraction (ported from upstream): the menu components module is
// the one whose factory contains five `function x(y){return null}` stubs,
// and the parser module references it alongside the menu API's error text.
const MENU_ITEMS_REGEX = /(function .{1,3}\(.{1,3}\){return null}){5}/;
const EXTRACT_REGEX =
  /\.type===.{1,3}\.(.{1,3})\)return .{1,3}\.push\((?:null!=.{1,3}\.props\..+?)?{type:"(.+?)",/g;
const EXTRACT_GROUP_REGEX = /\.type===.{1,3}\.(.{1,3})\){.+{type:"groupstart"/;
const EXTRACT_GROUP_ITEM_REGEX =
  /\.type===.{1,3}\.(.{1,3})\){.+{type:"(groupstart|customitem)".+\.type===.{1,3}\.(.{1,3})\){.+?{type:"(groupstart|customitem)"/;
const MENU_PARSER_TEXT = "Menu API only allows Items and groups of Items as children";

function discoverMenuComponents(): void {
  const bundle = getModule(byKeys(["MenuItem", "Menu"])) as
    Record<string, unknown> | null | undefined;
  menuComponents.Separator = bundle?.["MenuSeparator"];
  menuComponents.CheckboxItem = bundle?.["MenuCheckboxItem"];
  menuComponents.RadioItem = bundle?.["MenuRadioItem"];
  menuComponents.ControlItem = bundle?.["MenuControlItem"];
  menuComponents.Group = bundle?.["MenuGroup"];
  menuComponents.Item = bundle?.["MenuItem"];
  menuComponents.Menu = bundle?.["Menu"];

  if (menuComponents.Item && menuComponents.Group && menuComponents.Separator) return;

  // Fallback: parse component keys out of the parser module's factory.
  for (const webpackRequire of discovery().getRequires()) {
    const factories = webpackRequire.m;

    let menuItemsId: string | undefined;
    for (const key of Object.keys(factories)) {
      const factory = factories[key];
      if (typeof factory !== "function") continue;
      if (MENU_ITEMS_REGEX.test(String(factory))) {
        menuItemsId = key;
        break;
      }
    }
    if (menuItemsId === undefined) continue;

    let menuParser = "";
    for (const key of Object.keys(factories)) {
      const factory = factories[key];
      if (typeof factory !== "function") continue;
      const text = String(factory);
      if (text.includes(menuItemsId) && text.includes(MENU_PARSER_TEXT)) {
        menuParser = text;
        break;
      }
    }
    if (!menuParser) continue;

    const contextMenuComponents = webpackRequire(menuItemsId) as Record<string, unknown>;

    for (const [, key, type] of menuParser.matchAll(EXTRACT_REGEX)) {
      if (key === undefined || type === undefined) continue;
      const component = contextMenuComponents[key];
      switch (type) {
        case "separator":
          menuComponents.Separator ??= component;
          break;
        case "radio":
          menuComponents.RadioItem ??= component;
          break;
        case "checkbox":
          menuComponents.CheckboxItem ??= component;
          break;
        case "compositecontrol":
        case "control":
          menuComponents.ControlItem ??= component;
          break;
        case "customitem":
        case "item":
          menuComponents.Item ??= component;
          break;
        default:
          break;
      }
    }

    const groupMatch = EXTRACT_GROUP_REGEX.exec(menuParser);
    if (groupMatch?.[1]) menuComponents.Group ??= contextMenuComponents[groupMatch[1]];

    const groupItemMatch = EXTRACT_GROUP_ITEM_REGEX.exec(menuParser);
    if (groupItemMatch) {
      const [, firstKey, marker, secondKey] = groupItemMatch;
      const first = firstKey ? contextMenuComponents[firstKey] : undefined;
      const second = secondKey ? contextMenuComponents[secondKey] : undefined;
      if (marker === "groupstart") {
        menuComponents.Group ??= first;
        menuComponents.Item ??= second;
      } else {
        menuComponents.Item ??= first;
        menuComponents.Group ??= second;
      }
    }

    if (menuComponents.Item && menuComponents.Group && menuComponents.Separator) break;
  }

  menuComponents.Menu ??= getModule(
    byStrings("getContainerProps()", ".keyboardModeEnabled&&null!="),
    {
      searchExports: true,
    },
  );
}

function discoverActions(): void {
  try {
    const found = getModule(bySource("new DOMRect", "CONTEXT_MENU_CLOSE"), {
      searchDefault: false,
      map: {
        closeContextMenu: byStrings("CONTEXT_MENU_CLOSE"),
        openContextMenu: byStrings("renderLazy"),
      },
    }) as
      | {
          closeContextMenu?: () => void;
          openContextMenu?: (
            event: MouseEvent,
            render: (props: MenuRenderProps) => unknown,
            config?: MenuConfig,
          ) => void;
        }
      | undefined;

    if (found) Object.assign(contextMenuActions, found);
  } catch (error) {
    Logger.stacktrace("ContextMenu~Components", "Fatal startup error:", error as Error);
  }
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (const character of glob) {
    if (character === "*") {
      out += ".*";
      continue;
    }
    if ("\\^$+?.()|{}[]".includes(character)) out += "\\";
    out += character;
  }
  return new RegExp(`${out}$`);
}

const nodePatcher = new NodePatcher();

// Upstream declares the patcher the same way — a class whose statics hold
// all state — so plugin-facing behavior matches.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- upstream parity: all-static class with shared patch state.
class MenuPatcher {
  static readonly MAX_PATCH_ITERATIONS = 10;

  static patches: {
    named: Record<string, Set<PatchCallback>>;
    regex: { regex: RegExp; patches: Set<PatchCallback> }[];
  } = { named: {}, regex: [] };

  /** Wraps the menu component so patches see every rendered menu tree. */
  static handleRender(Component: unknown): unknown {
    const React = loadedReact();
    if (!React) return Component;

    const fNode = { type: Component } as BdReactElement;

    nodePatcher.patch(fNode, (props, node, instance) => {
      if (React.isValidElement(node)) {
        const element = node as BdReactElement & { props: Record<string, unknown> };
        const navId = element.props["navId"];
        if (typeof navId === "string") {
          // The render props come from the dispatcher event; the menu
          // callback sees them as MenuRenderProps, as upstream does.
          MenuPatcher.runPatches(navId, element, props as unknown as MenuRenderProps, instance);
        } else if (element.type && typeof element.type !== "string") {
          MenuPatcher.patchRecursive(element);
        }
      }
      return node;
    });

    return fNode.type;
  }

  /**
   * Wraps the menu component so patches see every rendered menu tree.
   * Returns whether the interceptor is armed.
   */
  static initialize(): boolean {
    const dispatcher = getDispatcher();
    const addInterceptor = dispatcher?.addInterceptor?.bind(dispatcher);
    if (!addInterceptor) {
      Logger.warn(
        "ContextMenu~Patcher",
        "Discord's dispatcher exposes no addInterceptor; context menu patches will not run.",
      );
      startupState = "failed";
      return false;
    }

    void MenuPatcher.contextMenuFixForLucide();

    addInterceptor((event) => {
      if (event.type !== "CONTEXT_MENU_OPEN") return;
      const contextMenu = event["contextMenu"] as ContextMenuObject | undefined;
      if (!contextMenu) return;

      if (contextMenu.renderLazy) {
        const renderLazy = contextMenu.renderLazy;
        contextMenu.renderLazy = async () =>
          MenuPatcher.handleRender(await renderLazy()) as (props: MenuRenderProps) => unknown;
      } else if (contextMenu.render) {
        contextMenu.render = MenuPatcher.handleRender(contextMenu.render) as (
          props: MenuRenderProps,
        ) => unknown;
      }
    });

    return true;
  }

  /** Reverts Discord's forced icon fill inside focused menu items. */
  static async contextMenuFixForLucide(): Promise<void> {
    const menuClasses = await waitForModule<Record<string, string>>(
      byKeys(["colorDefault", "focused"]),
    );
    if (!menuClasses) return;

    const { colorDefault, colorDanger, focused, checkboxContainer } = menuClasses;
    if (!colorDefault || !colorDanger || !focused || !checkboxContainer) return;

    DOMManager.injectStyle(
      "bd-lucide-context-menu-fix",
      `:where(.${colorDefault}, .${colorDanger}).${focused}:not(.${checkboxContainer}) .lucide:not(.lucide-betterdiscord) path {
        fill: revert;
      }`,
    );
  }

  /** Patches nested layers of a rendered tree, depth-bounded. */
  static patchRecursive(target: BdReactElement, iteration = 0): void {
    if (iteration >= MenuPatcher.MAX_PATCH_ITERATIONS) return;
    const React = loadedReact();
    if (!React) return;
    const depth = ++iteration;

    nodePatcher.patch(target, (props, res, instance) => {
      if (!React.isValidElement(res)) return res;
      // The render props come from the dispatcher event; the menu callback
      // sees them as MenuRenderProps, as upstream does.
      const renderProps = props as unknown as MenuRenderProps;
      const node = res as BdReactElement & { props: Record<string, unknown> };
      const nodeProps = node.props;
      const childProps =
        typeof nodeProps["children"] === "object" && nodeProps["children"] !== null
          ? (nodeProps["children"] as { props?: Record<string, unknown> })
          : undefined;

      const navId = (nodeProps["navId"] ?? childProps?.props?.["navId"]) as string | undefined;
      if (navId) {
        MenuPatcher.runPatches(navId, node, renderProps, instance);
        return res;
      }

      if (typeof nodeProps["children"] === "function") {
        const children = nodeProps["children"] as (...args: unknown[]) => unknown;
        const patched = React.cloneElement(node, {
          children: (...args: unknown[]) => {
            const child = children(...args);
            if (!React.isValidElement(child)) return child;

            const cElement = child as BdReactElement & { props: Record<string, unknown> };
            const cProps = cElement.props;
            const grandProps =
              typeof cProps["children"] === "object" && cProps["children"] !== null
                ? (cProps["children"] as { props?: Record<string, unknown> })
                : undefined;
            const cNavId = (cProps["navId"] ?? grandProps?.props?.["navId"]) as string | undefined;

            if (cNavId) {
              MenuPatcher.runPatches(cNavId, cElement, renderProps, instance);
            } else {
              const layer =
                typeof cProps["children"] === "object" && cProps["children"] !== null
                  ? (cProps["children"] as BdReactElement)
                  : cElement;
              if (layer.type && typeof layer.type !== "string") {
                MenuPatcher.patchRecursive(layer, depth);
              }
            }

            return child;
          },
        });
        return patched;
      }

      const layer =
        typeof nodeProps["children"] === "object" && nodeProps["children"] !== null
          ? (nodeProps["children"] as BdReactElement)
          : node;
      if (layer.type && typeof layer.type !== "string") {
        MenuPatcher.patchRecursive(layer, depth);
      }

      return res;
    });
  }

  static runPatches(
    id: string,
    res: BdReactElement,
    props: MenuRenderProps,
    instance?: Record<string, unknown>,
  ): void {
    const named = MenuPatcher.patches.named[id];
    if (named) {
      for (const patch of named) {
        try {
          patch(res, props, instance);
        } catch (error) {
          Logger.error("ContextMenu~runPatches", `Could not run ${id} patch for`, patch, error);
        }
      }
    }

    for (const entry of MenuPatcher.patches.regex) {
      if (!entry.regex.test(id)) continue;
      for (const patch of entry.patches) {
        try {
          patch(res, props, instance);
        } catch (error) {
          Logger.error("ContextMenu~runPatches", `Could not run ${id} patch for`, patch, error);
        }
      }
    }
  }

  static patch(id: string | RegExp, callback: PatchCallback): void {
    let target: string | RegExp = id;
    if (typeof target === "string" && target.includes("*")) target = globToRegExp(target);

    if (typeof target === "object") {
      const index = MenuPatcher.patches.regex.findIndex(
        (entry) => entry.regex.flags === target.flags && entry.regex.source === target.source,
      );
      if (index !== -1) {
        MenuPatcher.patches.regex[index]?.patches.add(callback);
      } else {
        MenuPatcher.patches.regex.push({ regex: target, patches: new Set([callback]) });
      }
      return;
    }

    MenuPatcher.patches.named[target] ??= new Set();
    MenuPatcher.patches.named[target]?.add(callback);
  }

  static unpatch(id: string | RegExp, callback: PatchCallback): void {
    let target: string | RegExp = id;
    if (typeof target === "string" && target.includes("*")) target = globToRegExp(target);

    if (typeof target === "object") {
      const index = MenuPatcher.patches.regex.findIndex(
        (entry) => entry.regex.flags === target.flags && entry.regex.source === target.source,
      );
      if (index !== -1) {
        const entry = MenuPatcher.patches.regex[index];
        if (!entry) return;
        entry.patches.delete(callback);
        if (entry.patches.size === 0) MenuPatcher.patches.regex.splice(index, 1);
      }
      return;
    }

    const named = MenuPatcher.patches.named[target];
    named?.delete(callback);
    if (named?.size === 0) Reflect.deleteProperty(MenuPatcher.patches.named, target);
  }
}

/**
 * Runs discovery and initialization; `true` when the API is live. While
 * startup stays pending (the menu chunk may simply not have downloaded
 * yet), the next call retries.
 */
function ensureStartup(): boolean {
  if (startupState === "ready") return true;
  if (startupState === "failed") return false;

  discoverMenuComponents();
  discoverActions();

  const componentsReady = Boolean(
    menuComponents.Item && menuComponents.Group && menuComponents.Separator && menuComponents.Menu,
  );
  const actionsReady = Boolean(
    contextMenuActions.openContextMenu && contextMenuActions.closeContextMenu,
  );

  if (!componentsReady || !actionsReady) {
    Logger.warn(
      "ContextMenu~Components",
      "Discord's context menu modules are not available yet; patches register but will not run until they are.",
    );
    return false;
  }

  try {
    if (!MenuPatcher.initialize()) return false;
  } catch (error) {
    Logger.error("ContextMenu~Patcher", "Fatal error:", error);
    startupState = "failed";
    return false;
  }

  startupState = "ready";

  try {
    // Upstream does this to silence a repeated React console warning.
    Object.defineProperty(document, "ownerDocument", { value: document });
  } catch {
    // Already defined by Discord or another mod; nothing to do.
  }

  return true;
}

function componentFor(name: keyof MenuComponentsShape, caller: string): unknown {
  const component = menuComponents[name];
  if (component === undefined) {
    Logger.error(
      caller,
      `Discord's ${name} menu component is unavailable; the item cannot be built.`,
    );
  }
  return component;
}

function reactFor(caller: string): BdReact | undefined {
  const React = loadedReact();
  if (!React) Logger.error(caller, "Discord's React is not available; the menu cannot be built.");
  return React;
}

/**
 * `ContextMenu` helps patch and create context menus; the shared instance
 * on `BdApi`.
 */
export class ContextMenu {
  /**
   * Patches a given context menu. Acts as a wrapper around the patcher.
   *
   * @param navId Discord's internal `navId` identifying the menu (globs
   * with `*` and regexes are supported).
   * @param callback Receives the React render tree.
   * @returns A function that automatically unpatches.
   */
  patch(navId: string | RegExp, callback: PatchCallback): () => void {
    ensureStartup();
    MenuPatcher.patch(navId, callback);
    return () => {
      MenuPatcher.unpatch(navId, callback);
    };
  }

  /**
   * Removes a patch added to a given context menu.
   */
  unpatch(navId: string | RegExp, callback: PatchCallback): void {
    ensureStartup();
    MenuPatcher.unpatch(navId, callback);
  }

  /**
   * Builds a single menu item; `type` selects the component, and the rest
   * of the props match the actual Discord item.
   */
  buildItem(props: MenuItem): unknown {
    ensureStartup();
    const React = reactFor("ContextMenu~buildItem");
    if (!React) return undefined;

    const { type } = props;

    if (type === "separator") {
      const Component = componentFor("Separator", "ContextMenu~buildItem");
      return Component ? React.createElement(Component) : undefined;
    }

    if (type === "group") {
      const Component = componentFor("Group", "ContextMenu~buildItem");
      if (!Component) return undefined;
      return React.createElement(Component, null, this.buildMenuChildren(props.items));
    }

    let componentName: keyof MenuComponentsShape = "Item";
    if (type === "submenu") {
      if (!props.children) {
        const children = props.render ?? props.items;
        if (children) props.children = this.buildMenuChildren(children);
      }
    } else if (type === "toggle" || type === "radio") {
      componentName = type === "toggle" ? "CheckboxItem" : "RadioItem";
      if (props.active) props.checked = props.active;
    } else if (type === "control") {
      componentName = "ControlItem";
    }

    const Component = componentFor(componentName, "ContextMenu~buildItem");
    if (!Component) return undefined;

    if (!props.id) {
      const label = typeof props.label === "string" ? props.label : "";
      props.id = label.replace(/^[^a-z]+|[^\w-]+/gi, "-");
    }

    if (props.type !== "control") {
      // Wrappers for older plugins and simplicity.
      if ((props as DefaultItem).danger) props.color = "danger";
      if (props.onClick && !props.action) props.action = props.onClick;
      props["extended"] = true;
    }

    if (type === "toggle") {
      const [active, doToggle] = React.useState(props.checked ?? false);
      const originalAction = props.action;
      props.checked = active;
      props.action = (event) => {
        originalAction?.(event);
        const prevented =
          typeof event === "object" &&
          event !== null &&
          (event as { defaultPrevented?: boolean }).defaultPrevented === true;
        if (!prevented) doToggle(!active);
      };
    }

    return React.createElement(Component, props);
  }

  /**
   * Creates all the items and groups of a context menu recursively.
   */
  buildMenuChildren(setup: readonly MenuItem[]): unknown[] {
    const React = reactFor("ContextMenu~buildMenuChildren");
    if (!React) return [];

    const mapper = (item: MenuItem): unknown => {
      if (item.type === "group") {
        const Component = componentFor("Group", "ContextMenu~buildMenuChildren");
        if (!Component) return undefined;
        return React.createElement(Component, null, item.items.map(mapper).filter(Boolean));
      }
      return this.buildItem(item);
    };

    return setup.map(mapper).filter(Boolean);
  }

  /**
   * Creates the menu component including the wrapping `ContextMenu`.
   */
  buildMenu(setup: readonly MenuItem[]): (props: MenuRenderProps) => unknown {
    return (props: MenuRenderProps) => {
      const React = reactFor("ContextMenu~buildMenu");
      const Component = componentFor("Menu", "ContextMenu~buildMenu");
      if (!React || !Component) return null;
      return React.createElement(Component, props, this.buildMenuChildren(setup));
    };
  }

  /**
   * Opens an entire context menu at a mouse event.
   */
  open(
    event: MouseEvent,
    menuComponent: (props: MenuRenderProps) => unknown,
    config?: MenuConfig,
  ): void {
    ensureStartup();
    const React = reactFor("ContextMenu~open");
    const openContextMenu = contextMenuActions.openContextMenu;
    if (!React || !openContextMenu) {
      Logger.warn("ContextMenu~open", "Discord's context menu actions are unavailable.");
      return;
    }
    openContextMenu(
      event,
      (props: MenuRenderProps) =>
        React.createElement(menuComponent, {
          ...props,
          onClose: contextMenuActions.closeContextMenu,
        }),
      config,
    );
  }

  /** Closes the currently open context menu immediately. */
  close(): void {
    ensureStartup();
    contextMenuActions.closeContextMenu?.();
  }

  /** Discord's separator component. */
  get Separator(): unknown {
    ensureStartup();
    return menuComponents.Separator;
  }

  /** Discord's checkbox (toggle) component. */
  get CheckboxItem(): unknown {
    ensureStartup();
    return menuComponents.CheckboxItem;
  }

  /** Discord's radio component. */
  get RadioItem(): unknown {
    ensureStartup();
    return menuComponents.RadioItem;
  }

  /** Discord's control component. */
  get ControlItem(): unknown {
    ensureStartup();
    return menuComponents.ControlItem;
  }

  /** Discord's group component. */
  get Group(): unknown {
    ensureStartup();
    return menuComponents.Group;
  }

  /** Discord's item component. */
  get Item(): unknown {
    ensureStartup();
    return menuComponents.Item;
  }

  /** Discord's menu component. */
  get Menu(): unknown {
    ensureStartup();
    return menuComponents.Menu;
  }
}

// Same construction upstream uses: the patcher arms as soon as the module
// loads; here that is deferred to first API use (see the module docblock).
export { MenuPatcher };

Object.freeze(ContextMenu);
Object.freeze(ContextMenu.prototype);
