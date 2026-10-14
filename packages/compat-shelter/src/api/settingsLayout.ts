/**
 * Drawing Shelter settings sections into Discord's own user settings.
 *
 * A port of upstream shelter's `src/settings.tsx` injection (uwu/shelter,
 * CC0-1.0 — see THIRD_PARTY.md) onto Ion's host. Discord's user settings is
 * a *layout tree* of plain descriptor objects — `{ key, type, layout,
 * useTitle, Component }` — which React renders, so a section becomes sibling
 * layout nodes rather than DOM spliced by hand. That is what makes the row
 * behave like a native one: Discord's own styling, tab order and search
 * (`useSearchTerms`), and Discord's own redraw when it rebuilds the tree.
 *
 * Two pieces of React internals are involved, both upstream's:
 *
 * - The tree is reached through `Object.prototype.buildLayout`. Discord's
 *   layout nodes build themselves through a prototype accessor, so a getter
 *   installed *before* the tree is built is handed the root on its first
 *   build. The `set` handler copies the value onto the instance, so every
 *   other writer Discord or another mod has is unaffected.
 * - A redraw after the modal is already open is forced by walking React's
 *   fiber tree to the modal's state and dispatching a fresh `Set` — the
 *   trick upstream's `rerenderSettings` uses, because that state has no
 *   public handle anywhere else.
 *
 * Both are installed only while at least one section is drawn, and taken
 * back out when the last one goes, so a session with no Shelter section
 * leaves Discord's prototype and the page's behavior untouched.
 *
 * The five node types and the nesting (section → sidebar item → panel →
 * category → setting) are upstream's, kept as they are: they are the shape
 * Discord's layout renderer dispatches on, and a wrong type number renders
 * a row that is subtly broken rather than one that is missing. The numbers
 * are *stolen* from Discord's own `language_and_time_panel` subtree, so a
 * build that renumbers them is followed automatically.
 */

import type { SettingsSection } from "./settings";

import { BadgeType, type SettingsBadge } from "./settings";
import { getFiber, hookStates, setStateDispatchers, walkFiber, type ReactFiber } from "./fiber";
import type { ReactSurface } from "./react";
import { createBridges, resolveBridgeReact, type SolidComponent } from "./bridges";

/** Every node this module injects carries this prefix in its key. */
const LAYOUT_PREFIX = "shelter";

/** Discord's own panel key holding the layout types this module steals. */
const LANGUAGE_AND_TIME_PANEL_KEY = "language_and_time_panel";

/** Discord's sidebar section the injected ones are placed after. */
const GAMES_AND_APPS_SECTION = "games_and_apps_section";

/** The root node of Discord's user-settings layout tree. */
const SETTINGS_ROOT_KEY = "$Root";

/** Group heading for sections registered without a `["header"]` above them. */
const DEFAULT_GROUP_TITLE = "Shelter";

/**
 * Upstream's fallback node types, used only for a build whose
 * `language_and_time_panel` subtree has moved or is missing a number.
 */
const FALLBACK_LAYOUT_TYPES: LayoutTypes = {
  section: 1,
  sidebarItem: 2,
  panel: 3,
  category: 5,
  setting: 19,
};

/** Renders a plugin's Solid component as one of Discord's React elements. */
export type SectionRenderer = (component: SolidComponent) => unknown;

/**
 * One node of Discord's user-settings layout tree.
 *
 * Only the fields this module reads or writes are declared; Discord's nodes
 * carry more (`buildLayout`, `partialRoot`, …) and those are none of its
 * business. This is a structural view, not a complete model.
 */
export interface LayoutNode {
  key?: string;
  layout?: readonly LayoutNode[];
  parent?: unknown;
  Component?: unknown;
  type?: number;
  useTitle?: unknown;
  usePersistentBadge?: unknown;
  useSearchTerms?: unknown;
  icon?: unknown;
}

/** The tree's root: `{ key: "$Root", layout: [], parent: undefined }`. */
export interface LayoutRoot {
  readonly key?: string;
  readonly layout: LayoutNode[];
  parent?: unknown;
}

/** The five node types Discord's layout renderer dispatches on. */
export interface LayoutTypes {
  readonly section: number;
  readonly sidebarItem: number;
  readonly panel: number;
  readonly category: number;
  readonly setting: number;
}

/** The `["section", id, title, component, extras?]` member of the union. */
export type SectionDescriptor = Extract<SettingsSection, { readonly 0: "section" }>;

/** A layout node, or undefined when the value is not one. */
function asNode(value: unknown): LayoutNode | undefined {
  return typeof value === "object" && value !== null ? value : undefined;
}

/** Reads `property` off a value that is an object, else undefined. */
function readProperty(value: unknown, property: string): unknown {
  const node = asNode(value);
  return node === undefined ? undefined : (node as Record<string, unknown>)[property];
}

/**
 * The topmost node reachable through `parent`.
 *
 * Discord's leaf layout nodes have no `layout` of their own, so the walk has
 * to go by `parent` alone and only ask whether the topmost node *is* a root
 * at the end — upstream's `while (root.parent) root = root.parent`.
 */
function topmostLayoutNode(node: unknown): LayoutRoot | undefined {
  let current = asNode(node);
  if (current === undefined) return undefined;
  for (;;) {
    const parent = asNode(readProperty(current, "parent"));
    if (parent === undefined) break;
    current = parent;
  }
  return asLayoutRoot(current);
}

/** A node's children: an empty list for a leaf or an unexpected shape. */
function children(node: LayoutNode): readonly LayoutNode[] {
  const layout: unknown = node.layout;
  return Array.isArray(layout) ? (layout as readonly LayoutNode[]) : [];
}

/** Discord's layout root, or undefined when the value is not one. */
function asLayoutRoot(value: unknown): LayoutRoot | undefined {
  const node = asNode(value);
  if (node === undefined || !Array.isArray(node.layout)) return undefined;
  return node as unknown as LayoutRoot;
}

/** A node's `type`, when it has a numeric one. */
function typeOf(node: LayoutNode): number | undefined {
  return typeof node.type === "number" ? node.type : undefined;
}

/** The five template types read off the five nodes, defaults for gaps. */
function typesOf(template: {
  readonly section: LayoutNode;
  readonly sidebarItem: LayoutNode;
  readonly panel: LayoutNode;
  readonly category: LayoutNode;
  readonly setting: LayoutNode;
}): LayoutTypes {
  return {
    section: typeOf(template.section) ?? FALLBACK_LAYOUT_TYPES.section,
    sidebarItem: typeOf(template.sidebarItem) ?? FALLBACK_LAYOUT_TYPES.sidebarItem,
    panel: typeOf(template.panel) ?? FALLBACK_LAYOUT_TYPES.panel,
    category: typeOf(template.category) ?? FALLBACK_LAYOUT_TYPES.category,
    setting: typeOf(template.setting) ?? FALLBACK_LAYOUT_TYPES.setting,
  };
}

/**
 * Steals the template types from Discord's own language-and-time panel: the
 * simplest subtree in the tree carrying all five node kinds, per upstream.
 * `undefined` means that subtree is gone, and the caller falls back to
 * upstream's default numbers.
 */
function stealLayoutTypes(layout: readonly unknown[]): LayoutTypes | undefined {
  for (const sectionValue of layout) {
    const section = asNode(sectionValue);
    if (section === undefined) continue;

    for (const itemValue of children(section)) {
      const item = asNode(itemValue);
      if (item === undefined) continue;

      const panel = children(item).find(
        (value) => asNode(value)?.key === LANGUAGE_AND_TIME_PANEL_KEY,
      );
      if (panel === undefined) continue;

      const category = children(asNode(panel) ?? {}).find((value) =>
        Array.isArray(asNode(value)?.layout),
      );
      if (category === undefined) continue;

      const setting = children(asNode(category) ?? {}).find(
        (value) => typeof asNode(value)?.Component === "function",
      );
      if (setting === undefined) continue;

      return typesOf({
        section,
        sidebarItem: item,
        panel: asNode(panel) ?? {},
        category: asNode(category) ?? {},
        setting: asNode(setting) ?? {},
      });
    }
  }
  return undefined;
}

/** Upstream's badge shapes, as Discord's `usePersistentBadge` values. */
function applyBadge(
  item: LayoutNode,
  badge: SettingsBadge | undefined,
  render: SectionRenderer,
): void {
  if (badge === undefined) return;
  if (badge.type === BadgeType.COUNT) {
    const count = badge.count;
    item.usePersistentBadge = () => ({ badgeType: BadgeType.COUNT, count });
  } else if (badge.type === BadgeType.STRONGLY_DISCOURAGED_CUSTOM) {
    const decoration = badge.customDecoration as SolidComponent;
    item.usePersistentBadge = () => ({
      badgeType: BadgeType.STRONGLY_DISCOURAGED_CUSTOM,
      customBadge: render(decoration),
    });
  } else {
    item.usePersistentBadge = () => ({ badgeType: badge.type });
  }
}

/** Builds the sidebar-item node a `["section", …]` descriptor draws as. */
function sidebarItemNode(
  descriptor: SectionDescriptor,
  types: LayoutTypes,
  render: SectionRenderer,
): LayoutNode {
  const [, id, name, pane] = descriptor;
  const extras = descriptor[4];

  const panel: LayoutNode = { key: `${LAYOUT_PREFIX}_${id}_panel`, layout: [], type: types.panel };
  const category: LayoutNode = {
    key: `${LAYOUT_PREFIX}_${id}_category`,
    layout: [],
    type: types.category,
  };
  // Discord calls this as a component, so it returns one element — which is
  // the bridge's job: the plugin's Solid tree inside Discord's React tree.
  const setting: LayoutNode = {
    key: `${LAYOUT_PREFIX}_${id}_setting`,
    Component: () => render(pane as SolidComponent),
    // Search terms are what make the row findable in Discord's settings
    // search, which upstream disables with the legacy `searchKey`.
    useSearchTerms: () => [name, id],
    type: types.setting,
  };
  const item: LayoutNode = {
    key: `${LAYOUT_PREFIX}_${id}_sidebar_item`,
    layout: [],
    type: types.sidebarItem,
    useTitle: () => name,
  };

  panel.layout = [category];
  category.layout = [setting];
  item.layout = [panel];

  // Upstream links these "just in case": some Discord builds walk `parent`
  // instead of `layout`, and the links cost nothing either way.
  setting.parent = category;
  category.parent = panel;
  panel.parent = item;

  applyBadge(item, extras?.badge, render);
  if (typeof extras?.icon === "function") {
    item.icon = () => render(extras.icon as SolidComponent);
  }

  return item;
}

/** One sidebar group: a heading plus the rows it contains. */
function groupNode(title: string, types: LayoutTypes): LayoutNode {
  return {
    key: `${LAYOUT_PREFIX}_${title.toLowerCase()}_section`,
    layout: [],
    type: types.section,
    useTitle: () => title,
  };
}

/**
 * The section tree the descriptors produce, in registration order.
 *
 * `["header"]` opens a group, `["section"]` appends a row to the open one,
 * and `["divider"]` is a no-op — Discord's layout has no divider node, which
 * is upstream's behaviour too. A row with no header above it lands in the
 * default group.
 */
function buildLayout(
  sections: readonly SettingsSection[],
  types: LayoutTypes,
  render: SectionRenderer,
): LayoutNode[] {
  const layout: LayoutNode[] = [];
  let group = groupNode(DEFAULT_GROUP_TITLE, types);
  let groupDrawn = false;

  for (const section of sections) {
    if (section[0] === "header") {
      group = groupNode(section[1], types);
      layout.push(group);
      groupDrawn = true;
      continue;
    }
    if (section[0] !== "section") continue;

    if (!groupDrawn) {
      layout.push(group);
      groupDrawn = true;
    }
    const row = sidebarItemNode(section, types, render);
    row.parent = group;
    group.layout = [...(group.layout ?? []), row];
  }

  return layout;
}

/** Rebuilds every injected node out of `root`, then splices the new ones in. */
function patchLayout(
  root: LayoutRoot,
  sections: readonly SettingsSection[],
  types: LayoutTypes,
  render: SectionRenderer,
): void {
  const { layout } = root;
  for (let index = layout.length - 1; index >= 0; index -= 1) {
    const key = layout[index]?.key;
    if (typeof key === "string" && key.startsWith(`${LAYOUT_PREFIX}_`)) layout.splice(index, 1);
  }

  const anchor = layout.findIndex((node) => node.key === GAMES_AND_APPS_SECTION);
  const at = anchor === -1 ? layout.length : anchor + 1;
  const generated = buildLayout(sections, types, render);
  for (const group of generated) {
    group.parent = root;
    layout.splice(at, 0, group);
  }
}

/** Whether a fiber holds the settings modal's `partialRoot` prop. */
function holdsPartialRoot(fiber: ReactFiber): boolean {
  const fromOwn = fiber.memoizedProps?.["partialRoot"] !== undefined;
  const fromNext = fiber.pendingProps?.["partialRoot"] !== undefined;
  return fromOwn || fromNext;
}

/** The settings layout root held in one of a fiber's hooks. */
function layoutRootFromHooks(fiber: ReactFiber): LayoutRoot | undefined {
  for (const state of hookStates(fiber)) {
    if (!Array.isArray(state)) continue;
    const root = asLayoutRoot(state[0]);
    if (root?.key === SETTINGS_ROOT_KEY) return root;
  }
  return undefined;
}

/** What {@link createSettingsLayoutHost} needs to draw into Discord's settings. */
export interface SettingsLayoutOptions {
  /** Discord's React, resolved from the page; sections render through it. */
  readonly react: ReactSurface;
  /** The document Discord's settings modal lives in. */
  readonly doc: Document;
  /** Reports a degradation the adapter cannot fix, at adapter level. */
  readonly warn: (message: string) => void;
}

/** The Discord-side drawing surface the settings API drives. */
export interface SettingsLayoutHost {
  /**
   * Replaces the sections drawn into Discord's settings and makes it redraw
   * them. Returns false when nothing could be drawn at all — which is the
   * one case where the caller has to say so to the plugin that asked.
   */
  draw(sections: readonly SettingsSection[]): boolean;
}

/** Marks the roots this module has already patched. */
const PATCHED = Symbol("ion.shelter.settingsLayout.patched");

/** Whether this module has already injected into `root`. */
function isPatched(root: LayoutRoot): boolean {
  return (root as unknown as Record<symbol, unknown>)[PATCHED] === true;
}

/** Marks `root` as injected, so the hook injects into it once. */
function markPatched(root: LayoutRoot): void {
  Object.defineProperty(root, PATCHED, { value: true, configurable: true });
}

/**
 * Lets Discord build its own layout tree, then injects ours into the root.
 *
 * The getter fires on every object Discord gives a `buildLayout` property;
 * only the settings tree's root has `$Root`, and only once per root, so the
 * work is a microtask per build rather than per node.
 */
function installLayoutHook(draw: (root: LayoutRoot) => void): () => void {
  Object.defineProperty(Object.prototype, "buildLayout", {
    configurable: true,
    enumerable: false,
    get(this: unknown): void {
      queueMicrotask(() => {
        const root = topmostLayoutNode(this);
        if (root?.key !== SETTINGS_ROOT_KEY) return;
        if (isPatched(root)) return;
        markPatched(root);
        draw(root);
      });
    },
    set(this: unknown, value: unknown): void {
      // Discord writes its own builder onto the instances; writing it on the
      // prototype instead would shadow it for everything else on the page.
      if (this === Object.prototype) return;
      Object.defineProperty(this, "buildLayout", {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    },
  });

  return () => {
    delete (Object.prototype as Partial<Record<"buildLayout", unknown>>).buildLayout;
  };
}

/**
 * Forces the open settings modal to redraw by dispatching a fresh `Set` of
 * the same sections into the state React holds them in.
 */
function rerenderModal(
  root: LayoutRoot,
  drawn: readonly SettingsSection[],
  render: SectionRenderer,
  doc: Document,
): void {
  const anchor = doc.querySelector("[data-settings-sidebar-item]");
  if (!(anchor instanceof Element)) return;

  const fiber = getFiber(anchor);
  const modal = walkFiber(
    fiber,
    (node) => holdsPartialRoot(node) && setStateDispatchers(node).length >= 2,
    true,
    true,
  );
  if (modal === undefined) return;

  // The modal's own state holds the root that renders, which is not
  // necessarily the one the layout hook saw: patch whichever we can reach,
  // stealing its types rather than assuming they match.
  const target = layoutRootFromHooks(modal) ?? root;
  patchLayout(target, drawn, stealLayoutTypes(target.layout) ?? FALLBACK_LAYOUT_TYPES, render);

  // A copy of the same Set is all React needs to render again.
  const dispatch = setStateDispatchers(modal)[0];
  if (dispatch !== undefined) {
    dispatch((previous: unknown) => new Set<unknown>(previous as Iterable<unknown>));
  }
}

/**
 * Builds the host that draws sections into Discord's settings.
 *
 * Sections are drawn twice over on purpose: once into the layout tree (so a
 * modal opened later shows them), and once through the modal's own state
 * (so a modal already open redraws). Both paths run the same
 * `patchLayout`, which removes the previous nodes first, so repeating them
 * is idempotent.
 */
export function createSettingsLayoutHost(options: SettingsLayoutOptions): SettingsLayoutHost {
  const pair = resolveBridgeReact(options.react);
  const bridges = createBridges(options.react);
  const render: SectionRenderer = (component) => bridges.renderSolidInReact(component);

  let drawn: readonly SettingsSection[] = [];
  let root: LayoutRoot | undefined;
  let unhook: (() => void) | undefined;
  let warnedFallback = false;

  const typesFor = (target: LayoutRoot): LayoutTypes => {
    const stolen = stealLayoutTypes(target.layout);
    if (stolen === undefined) {
      // One line, not one per draw: the fallback still renders rows, but
      // only Discord's own numbers are guaranteed to be right.
      if (!warnedFallback) {
        warnedFallback = true;
        options.warn(
          `Discord's settings layout templates could not be found (key: ${LANGUAGE_AND_TIME_PANEL_KEY}); ` +
            `Shelter sections fall back to upstream's default node types`,
        );
      }
      return FALLBACK_LAYOUT_TYPES;
    }
    return stolen;
  };

  const draw = (sections: readonly SettingsSection[]): boolean => {
    drawn = sections;
    // Without Discord's React there is nothing to render a section with, so
    // the caller reports it to the plugin that registered one.
    if (pair === undefined) return false;

    if (root !== undefined) {
      const types = typesFor(root);
      patchLayout(root, drawn, types, render);
      rerenderModal(root, drawn, render, options.doc);
    }

    if (drawn.length > 0 && unhook === undefined) {
      unhook = installLayoutHook((built) => {
        root = built;
        patchLayout(built, drawn, typesFor(built), render);
      });
    } else if (drawn.length === 0 && unhook !== undefined) {
      unhook();
      unhook = undefined;
    }

    return true;
  };

  return { draw };
}
