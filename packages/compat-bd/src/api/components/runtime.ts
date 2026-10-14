/**
 * Shared runtime plumbing for the ported `BdApi.Components` surface.
 *
 * Every factory here takes Discord's React explicitly instead of importing
 * it: the adapter bundle evaluates before any Discord script exists, so the
 * components can only be built once `getReact()` resolves. This also makes
 * the whole surface unit-testable with a fake React.
 */

import { loadedReact } from "../../modules/discord-modules";

/** Discord's React, narrowed to what the ported components call. */
export interface ComponentsReact {
  createElement(
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
  cloneElement(
    element: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
  Component: new <P>(props: P) => {
    props: P;
    state: Record<string, unknown>;
    setState(state: Record<string, unknown>): void;
    render(): unknown;
  };
  Fragment: unknown;
  createContext(defaultValue: unknown): unknown;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- React's own shape: the parameter exists only in the return type.
  useContext<T>(context: unknown): T;
  useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  useCallback<T>(callback: T, deps?: readonly unknown[]): T;
  useRef<T>(initial: T): { current: T };
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- React's cleanup contract: the effect may return a disposer or nothing.
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- React's cleanup contract: the effect may return a disposer or nothing.
  useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
}

/** Discord's React, or undefined while it is still unavailable. */
export function componentsReact(): ComponentsReact | undefined {
  const React = loadedReact() as unknown as ComponentsReact | undefined;
  if (!React || typeof React.createElement !== "function") return undefined;
  return React;
}

/**
 * `clsx`'s role in one small function (upstream's components depend on it;
 * we do not add the dependency): strings pass through, `false`/`null`/
 * `undefined` are dropped, and condition maps keep their truthy keys.
 */
export function cx(...values: readonly unknown[]): string {
  const out: string[] = [];
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) out.push(value);
    else if (typeof value === "object" && value !== null) {
      for (const [key, on] of Object.entries(value)) {
        if (on) out.push(key);
      }
    }
  }
  return out.join(" ");
}

/** Lucide icon geometry (paths as path-data, 24×24 grid) — see THIRD_PARTY.md. */
const ICON_PATHS = {
  check: ["M20 6 9 17l-5-5"],
  chevronDown: ["m6 9 6 6 6-6"],
  plus: ["M5 12h14", "M12 5v14"],
  minus: ["M5 12h14"],
  search: ["m21 21-4.34-4.34"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  keyboard: [
    "M10 8h.01",
    "M12 12h.01",
    "M14 8h.01",
    "M16 12h.01",
    "M18 8h.01",
    "M6 8h.01",
    "M7 16h10",
    "M8 12h.01",
  ],
  pipette: [
    "m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12",
    "m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z",
    "m2 22 .414-.414",
  ],
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Geometry shared by every lucide icon upstream renders in these components. */
const ICON_GEOMETRY = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * Renders a lucide icon with `size` (a lucide prop: px string or number).
 * Lucide sizes via width/height, so those attributes are overridden.
 */
export function createIcon(react: ComponentsReact, name: IconName) {
  return (props: { size?: number | string; color?: string; className?: string } = {}) => {
    const shapes: unknown[] = ICON_PATHS[name].map((d) => react.createElement("path", { d }));
    if (name === "search") {
      shapes.push(react.createElement("circle", { cx: 11, cy: 11, r: 8 }));
    }
    if (name === "keyboard") {
      shapes.push(react.createElement("rect", { width: 20, height: 16, x: 2, y: 4, rx: 2 }));
    }
    const { size, color, className } = props;
    return react.createElement(
      "svg",
      {
        ...ICON_GEOMETRY,
        ...(size === undefined ? {} : { width: size, height: size }),
        ...(color === undefined ? {} : { color }),
        ...(className === undefined ? {} : { className }),
      },
      ...shapes,
    );
  };
}
