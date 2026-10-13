// @vitest-environment happy-dom
/* eslint-disable no-console */
// Unit tests for the ported `BdApi.Components` surface. Discord's React is
// a fake that implements exactly the hooks and createElement contract the
// components use, so the tests exercise the real component code paths
// (class maps, controlled bindings, statics) without a renderer. Module
// discovery is faked the same way the other api tests fake it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IonGlobal } from "@ion/core";

import { Components } from "./index";
import type { ComponentsReact } from "./runtime";

interface Element {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
}

/** The React stand-in: stateless hooks, element-recording createElement. */
const fakeReact: ComponentsReact = {
  createElement: (type, props = {}, ...children) => ({ type, props, children }),
  cloneElement: (element) => element,
  Fragment: Symbol("fragment"),
  Component: class {
    props: unknown;
    state: Record<string, unknown> = {};
    constructor(props: unknown) {
      this.props = props;
    }
    setState(next: Record<string, unknown>): void {
      this.state = { ...this.state, ...next };
    }
    render(): unknown {
      return null;
    }
  } as unknown as ComponentsReact["Component"],
  createContext: (defaultValue) => ({ __defaultValue: defaultValue }),
  useContext: (context) => (context as { __defaultValue: never }).__defaultValue,
  useState: (initial) =>
    [
      typeof initial === "function" ? (initial as () => never)() : initial,
      () => undefined,
    ] as never,
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
  useRef: (initial) => ({ current: initial }),
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
};

let findable: unknown[];

/** Narrows a rendered value to an element record. */
function element(value: unknown): Element {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error(`not an element: ${String(value)}`);
  }
  return value as Element;
}

function classes(value: unknown): string {
  const className = element(value).props["className"];
  return typeof className === "string" ? className : "";
}

function children(value: unknown): unknown[] {
  return element(value).children;
}

beforeEach(() => {
  // Discord's React module is the only findable one until a test says so.
  findable = [fakeReact];
  const discovery = {
    find: (filter: (exports: unknown) => boolean) => {
      for (const candidate of findable) {
        if (candidate === null || candidate === undefined) continue;
        if (filter(candidate)) return candidate;
      }
      return undefined;
    },
    getRequires: () => [],
    waitFor: () => () => undefined,
  };
  (window as unknown as { __ION__: IonGlobal }).__ION__ = { discovery } as unknown as IonGlobal;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("before Discord's React exists", () => {
  it("keeps every member undefined instead of throwing", async () => {
    vi.resetModules();
    findable = [];
    const { Components: Fresh } = await import("./index");
    const api = new Fresh();
    expect(api.Text).toBeUndefined();
    expect(api.Flex).toBeUndefined();
    expect(api.Button).toBeUndefined();
    expect(api.Spinner).toBeUndefined();
    expect(api.Switch).toBeUndefined();
    expect(api.Tooltip).toBeUndefined();
    expect(api.ErrorBoundary).toBeUndefined();
  });
});

describe("base components", () => {
  it("renders Text with BD's color/size classes and statics", () => {
    const Text = new Components().Text;
    if (!Text) throw new Error("Text did not resolve");
    expect(Text.Colors.STANDARD).toBe("bd-text-normal");
    expect(Text.Sizes.SIZE_14).toBe("bd-text-14");

    const plain = element(Text({ children: "hi" }));
    expect(plain.type).toBe("div");
    expect(classes(plain)).toBe("bd-text-normal bd-text-14");
    expect(plain.children).toEqual(["hi"]);

    const custom = element(
      Text({
        tag: "span",
        color: Text.Colors.ERROR,
        size: Text.Sizes.SIZE_20,
        strong: true,
        selectable: true,
        className: "extra",
        id: "note",
      }),
    );
    expect(custom.type).toBe("span");
    expect(classes(custom)).toBe("bd-text-error bd-text-20 extra bd-selectable bd-text-strong");
    expect(custom.props["id"]).toBe("note");
  });

  it("renders Flex with direction maps, style defaults, and Flex.Child", () => {
    const Flex = new Components().Flex;
    if (!Flex) throw new Error("Flex did not resolve");
    expect(Flex.Direction.VERTICAL).toBe("bd-flex-vertical");
    expect(Flex.Align.CENTER).toBe("bd-flex-align-center");

    const row = element(Flex({ direction: Flex.Direction.VERTICAL, children: "x" }));
    expect(classes(row)).toBe(
      "bd-flex bd-flex-vertical bd-flex-justify-start bd-flex-align-stretch bd-flex-no-wrap",
    );
    expect(row.props["style"]).toEqual({ flexShrink: 1, flexGrow: 1, flexBasis: "auto" });

    // Flex.Child delegates to Flex: it produces a Flex element with the
    // child class appended (rendering is React's job, not the fake's).
    const child = element(Flex.Child({ className: "a" }));
    expect(child.type).toBe(Flex);
    expect(child.props["className"]).toBe("a bd-flex-child");
  });

  it("renders Button with look/color/size maps and a guarded click", () => {
    const Button = new Components().Button;
    if (!Button) throw new Error("Button did not resolve");
    expect(Button.Looks.BLANK).toBe("bd-button-blank");

    const onClick = vi.fn();
    const el = element(Button({ onClick, children: "ok" }));
    expect(classes(el)).toContain("bd-button-filled");
    expect(classes(el)).toContain("bd-button-color-brand");
    expect(classes(el)).toContain("bd-button-medium");
    expect(classes(el)).toContain("bd-button-grow");

    const content = element(children(el)[0]);
    expect(content.props["className"]).toBe("bd-button-content");
    expect(content.children).toEqual(["ok"]);

    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const handler = el.props["onClick"];
    if (typeof handler !== "function") throw new Error("no click handler");
    (handler as (arg: typeof event) => void)(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith(event);

    const disabled = element(Button({ disabled: true, onClick, children: "x" }));
    const disabledHandler = disabled.props["onClick"];
    if (typeof disabledHandler !== "function") throw new Error("no click handler");
    (disabledHandler as () => void)();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders Spinner variants the way upstream does", () => {
    const Spinner = new Components().Spinner;
    if (!Spinner) throw new Error("Spinner did not resolve");
    expect(Spinner.Type.PULSING_ELLIPSIS).toBe("pulsing-ellipsis");

    const cubes = element(Spinner({}));
    expect(cubes.type).toBe("span");
    expect(classes(cubes)).toBe("bd-spinner bd-spinner-wandering-cubes");
    expect(children(element(children(cubes)[0]))).toHaveLength(2);

    const pulsing = element(Spinner({ type: Spinner.Type.PULSING_ELLIPSIS }));
    expect(children(element(children(pulsing)[0]))).toHaveLength(3);

    const circle = element(Spinner({ type: Spinner.Type.SPINNING_CIRCLE }));
    expect(circle.type).toBe("div");
    const svg = element(children(element(children(circle)[0]))[0]);
    expect(svg.type).toBe("svg");
  });
});

describe("settings components", () => {
  it("renders SettingItem with header, note, children, and divider", () => {
    const SettingItem = new Components().SettingItem;
    if (!SettingItem) throw new Error("SettingItem did not resolve");
    const el = element(SettingItem({ id: "row", name: "Row", note: "help", children: "control" }));
    expect(classes(el)).toBe("bd-setting-item");
    const [header, note, control, divider] = children(el);
    expect(classes(header)).toBe("bd-setting-header");
    expect(classes(note)).toBe("bd-setting-note");
    expect(control).toBe("control");
    expect(classes(divider)).toBe("bd-setting-divider");

    const inline = element(SettingItem({ id: "row", inline: true, children: "control" }));
    expect(classes(inline)).toContain("inline");
    expect(children(inline)).toHaveLength(3);
  });

  it("binds Switch as a controlled toggle", () => {
    const Switch = new Components().Switch;
    if (!Switch) throw new Error("Switch did not resolve");
    const onChange = vi.fn();
    const el = element(Switch({ value: true, onChange }));
    expect(classes(el)).toContain("bd-switch-checked");
    expect(classes(el)).not.toContain("bd-switch-disabled");

    const input = children(el)[0];
    const handler = element(input).props["onChange"];
    if (typeof handler !== "function") throw new Error("no change handler");
    (handler as () => void)();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("binds Search's value and reset button", () => {
    const Search = new Components().Search;
    if (!Search) throw new Error("Search did not resolve");
    const withValue = element(Search({ value: "ion" }));
    const input = element(children(withValue)[0]);
    expect(input.props["value"]).toBe("ion");
    expect(children(withValue)).toHaveLength(2);
    expect(element(children(withValue)[1]).type).toBe("button");

    const empty = element(Search({ value: "" }));
    expect(children(empty)).toHaveLength(2);
    expect(element(children(empty)[1]).type).toBe("svg");
  });

  it("selects Radio options through the controlled binding", () => {
    const Radio = new Components().Radio;
    if (!Radio) throw new Error("Radio did not resolve");
    const onChange = vi.fn();
    const el = element(
      Radio({
        name: "pick",
        value: "b",
        onChange,
        options: [
          { name: "A", value: "a" },
          { name: "B", value: "b" },
        ],
      }),
    );
    const [optionA, optionB] = children(el);
    expect(classes(optionA)).toBe("bd-radio-option");
    expect(classes(optionB)).toBe("bd-radio-option bd-radio-selected");
    const input = element(children(optionA)[0]);
    const handler = input.props["onChange"];
    if (typeof handler !== "function") throw new Error("no change handler");
    (handler as () => void)();
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("positions the Slider label from its value", () => {
    const Slider = new Components().Slider;
    if (!Slider) throw new Error("Slider did not resolve");
    const el = element(Slider({ value: 5, min: 0, max: 10, units: "%" }));
    const [, label, track] = children(el);
    expect(classes(label)).toBe("bd-slider-label");
    expect(element(label).props["style"]).toEqual({
      left: "50%",
      transform: "translateX(-43.75%)",
    });
    expect(element(label).children).toEqual(["5%"]);
    expect(element(track).props["style"]).toEqual({ backgroundSize: "50% 100%" });
  });

  it("renders Keybind's display value and formats Control", () => {
    const Keybind = new Components().Keybind;
    if (!Keybind) throw new Error("Keybind did not resolve");
    const el = element(Keybind({ value: ["Control", "KeyI"] }));
    const input = element(children(el)[1]);
    expect(input.props["value"]).toBe("Ctrl + KeyI");
    expect(classes(el)).toBe("bd-keybind-wrap");
  });

  it("renders Dropdown with the selected label and options", () => {
    const Dropdown = new Components().Dropdown;
    if (!Dropdown) throw new Error("Dropdown did not resolve");
    const el = element(
      Dropdown({
        value: "b",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    );
    const [button, list] = children(el);
    const valueSpan = element(children(button)[0]);
    expect(valueSpan.children).toEqual(["B"]);
    const options = children(list);
    expect(options).toHaveLength(2);
    expect(classes(options[1])).toContain("selected");
  });
});

describe("the Components surface", () => {
  it("memoizes members and injects upstream's stylesheet once", () => {
    const api = new Components();
    expect(api.Text).toBe(api.Text);
    expect(api.Button).toBe(api.Button);

    const styles = document.querySelectorAll("style[data-ion-bd-components]");
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain(".bd-text-normal");
  });

  it("resolves Tooltip from module discovery", () => {
    // Discord's Tooltip is a class HOC whose prototype carries renderTooltip.
    class Tooltip {
      renderTooltip(): undefined {
        return undefined;
      }
    }
    findable.push(Tooltip);
    expect(new Components().Tooltip).toBe(Tooltip);
  });

  it("renders ErrorBoundary's fallback and freezes render against patching", () => {
    const Boundary = new Components().ErrorBoundary;
    if (!Boundary) throw new Error("ErrorBoundary did not resolve");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const instance = new Boundary({ children: "content", fallback: "oops" });
    instance.setState({ hasError: true });
    expect(instance.render()).toBe("oops");

    const plain = new Boundary({ children: "content" });
    plain.setState({ hasError: true });
    const div = element(plain.render());
    expect(classes(div)).toBe("react-error");

    expect(() => {
      (Boundary.prototype as unknown as { render: () => unknown }).render = () => null;
    }).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });

  it("exposes the same instance on BdApi statically and per-plugin", async () => {
    const { BdApi } = await import("../index");
    expect(new BdApi("components-test").Components).toBe(BdApi.Components);
  });
});
