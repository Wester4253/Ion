/**
 * `SettingItem` and the settings inputs, ported from upstream's
 * `@ui/settings/components/{item,switch,textbox,checkbox,number,radio,
 * search,slider,keybind,dropdown,color}` (Apache-2.0 — see
 * THIRD_PARTY.md). All are React+CSS only, so the port is mechanical:
 * JSX → `createElement`, `clsx` → `cx`, lucide icons → `createIcon`, and
 * the `useItemProps` binding → the local `createUseItemProps`.
 */

import {
  createButton,
  BUTTON_COLORS,
  BUTTON_LOOKS,
  BUTTON_SIZES,
  createFlex,
  FLEX_ALIGN,
  FLEX_DIRECTION,
} from "./base";
import { useCallbackRefFor } from "./hooks";
import { tooltipComponent } from "./lookups";
import { createIcon, cx, type ComponentsReact } from "./runtime";
import { createUseItemProps } from "./settings-utils";

/** A DOM change event as the inputs receive it from React. */
interface ChangeEvent {
  currentTarget: { value: string; valueAsNumber: number };
}

export interface SettingItemProps {
  id: string;
  name?: string;
  note?: string;
  inline?: boolean;
  children?: unknown;
  divider?: boolean;
  [key: string]: unknown;
}

/** BD's settings row (`SettingItem`). */
export function createSettingItem(react: ComponentsReact) {
  return (props: SettingItemProps) => {
    const { id, name, note, inline, children, divider = true } = props;
    const headerChildren: unknown[] = [
      react.createElement("label", { htmlFor: id, className: "bd-setting-title" }, name),
    ];
    if (inline) headerChildren.push(children);
    const body: unknown[] = [
      react.createElement("div", { className: "bd-setting-header" }, ...headerChildren),
      react.createElement("div", { className: "bd-setting-note" }, note),
    ];
    if (!inline) body.push(children);
    if (divider) body.push(react.createElement("hr", { className: "bd-setting-divider" }));
    return react.createElement(
      "div",
      { className: cx("bd-setting-item", inline && "inline") },
      ...body,
    );
  };
}

export interface SwitchProps {
  id?: string;
  value?: boolean;
  defaultValue?: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
  [key: string]: unknown;
}

/** BD's switch input (`Switch`). */
export function createSwitch(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  return (props: SwitchProps) => {
    const { state, setState, disabled } = useItemProps<boolean, unknown>(
      props,
      (_event, current) => !current,
    );
    return react.createElement(
      "div",
      {
        className: cx("bd-switch", {
          "bd-switch-disabled": disabled,
          "bd-switch-checked": state,
        }),
      },
      react.createElement("input", {
        id: props.id,
        type: "checkbox",
        disabled,
        checked: state,
        onChange: (event: unknown) => {
          setState(event);
        },
      }),
      react.createElement(
        "div",
        { className: "bd-switch-body" },
        react.createElement(
          "svg",
          {
            className: "bd-switch-slider",
            viewBox: "0 0 28 20",
            preserveAspectRatio: "xMinYMid meet",
          },
          react.createElement("rect", {
            className: "bd-switch-handle",
            fill: "white",
            x: 4,
            y: 0,
            height: 20,
            width: 20,
            rx: 10,
          }),
          react.createElement(
            "svg",
            { className: "bd-switch-symbol", viewBox: "0 0 20 20", fill: "none" },
            react.createElement("path", {}),
            react.createElement("path", {}),
          ),
        ),
      ),
    );
  };
}

export interface TextboxProps {
  value?: string;
  defaultValue?: string;
  maxLength?: number;
  placeholder?: string;
  onKeyDown?: (event: unknown) => void;
  onChange?: (value: string) => void;
  disabled?: boolean;
  [key: string]: unknown;
}

/** BD's text input (`Textbox`). */
export function createTextbox(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  return (props: TextboxProps) => {
    const { maxLength, placeholder, onKeyDown } = props;
    const { state, setState, disabled } = useItemProps<string, ChangeEvent>(
      props,
      (event) => event.currentTarget.value,
    );
    return react.createElement("input", {
      onChange: (event: ChangeEvent) => {
        setState(event);
      },
      onKeyDown,
      type: "text",
      className: "bd-text-input",
      placeholder,
      maxLength,
      value: state,
      disabled,
    });
  };
}

export interface CheckboxProps {
  id?: string;
  value?: boolean;
  defaultValue?: boolean;
  onChange?: (value: boolean) => void;
  className?: string;
  inputClassName?: string;
  iconClassName?: string;
  label?: unknown;
  labelClassName?: string;
  disabled?: boolean;
  reverse?: boolean;
  [key: string]: unknown;
}

/** BD's checkbox input (`Checkbox`). */
export function createCheckbox(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  const Flex = createFlex(react);
  const CheckIcon = createIcon(react, "check");
  return (props: CheckboxProps) => {
    const { state, setState, disabled } = useItemProps<boolean, unknown>(
      props,
      (_event, current) => !current,
    );
    const children: unknown[] = [
      react.createElement("input", {
        type: "checkbox",
        checked: state,
        id: props.id,
        className: cx("bd-checkbox-input", props.inputClassName),
      }),
      react.createElement(
        "div",
        { className: cx("bd-checkbox-box", props.iconClassName) },
        CheckIcon({ size: 18 }),
      ),
    ];
    if (props.label) {
      children.push(
        react.createElement(
          "div",
          { className: cx("bd-checkbox-label", props.labelClassName) },
          props.label,
        ),
      );
    }
    return Flex({
      className: cx("bd-checkbox", props.className, {
        "bd-checkbox-disabled": disabled,
        "bd-checkbox-has-label": props.label,
        "bd-checkbox-reverse": props.reverse,
      }),
      align: FLEX_ALIGN.CENTER,
      direction: props.reverse ? FLEX_DIRECTION.HORIZONTAL_REVERSE : FLEX_DIRECTION.HORIZONTAL,
      onClick: () => {
        setState(null);
      },
      children,
    });
  };
}

export interface NumberInputProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  [key: string]: unknown;
}

/** BD's number stepper (`Number`). */
export function createNumber(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  const Button = createButton(react);
  const PlusIcon = createIcon(react, "plus");
  const MinusIcon = createIcon(react, "minus");
  return (props: NumberInputProps) => {
    const { min, max, step = 1 } = props;
    const { state, setState, disabled } = useItemProps<number, number | ChangeEvent>(
      props,
      (value) => (typeof value === "object" ? value.currentTarget.valueAsNumber : value),
    );
    const clamp = (next: number): boolean => {
      if (max !== undefined && next > max) return false;
      if (min !== undefined && next < min) return false;
      return true;
    };
    return react.createElement(
      "div",
      { className: `bd-number-input-wrapper${disabled ? " bd-number-input-disabled" : ""}` },
      Button({
        size: BUTTON_SIZES.ICON,
        look: BUTTON_LOOKS.FILLED,
        color: BUTTON_COLORS.PRIMARY,
        className: "bd-number-input-decrement",
        onClick: () => {
          const current = typeof state === "number" ? state : parseFloat(String(state));
          const next = current - step;
          if (clamp(next)) setState(next);
        },
        children: MinusIcon({ size: 24 }),
      }),
      react.createElement("input", {
        onChange: (event: ChangeEvent) => {
          setState(event);
        },
        type: "number",
        className: "bd-number-input",
        min,
        max,
        step,
        value: state,
        disabled,
      }),
      Button({
        size: BUTTON_SIZES.ICON,
        look: BUTTON_LOOKS.FILLED,
        color: BUTTON_COLORS.PRIMARY,
        className: "bd-number-input-increment",
        onClick: () => {
          const current = typeof state === "number" ? state : parseFloat(String(state));
          const next = current + step;
          if (clamp(next)) setState(next);
        },
        children: PlusIcon({ size: 24 }),
      }),
    );
  };
}

export interface RadioOption {
  name: string;
  value: unknown;
  color?: string;
  description?: string;
}

export interface RadioProps {
  name?: string;
  options: RadioOption[];
  value?: unknown;
  defaultValue?: unknown;
  onChange?: (value: unknown) => void;
  disabled?: boolean;
  [key: string]: unknown;
}

/** BD's radio group (`Radio`). */
export function createRadio(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  return (props: RadioProps) => {
    const { name, options } = props;
    const { state, setState, disabled } = useItemProps<unknown>(props);

    const children: unknown[] = options.map((option, index) => {
      const selected = option.value === state;
      return react.createElement(
        "label",
        {
          key: index,
          className: `bd-radio-option${selected ? " bd-radio-selected" : ""}`,
          style: { borderColor: option.color ?? "transparent" },
        },
        react.createElement("input", {
          onChange: () => {
            setState(option.value);
          },
          type: "radio",
          name,
          checked: selected,
          value: index,
          disabled,
        }),
        react.createElement(
          "svg",
          { className: "bd-radio-indicator", width: 24, height: 24, viewBox: "0 0 24 24" },
          react.createElement("circle", {
            cx: 12,
            cy: 12,
            r: 12,
            strokeWidth: 2,
            fill: "none",
            className: "bd-radio-icon",
          }),
          selected ? react.createElement("circle", { cx: 12, cy: 12, r: 5, fill: "#fff" }) : null,
        ),
        react.createElement(
          "div",
          { className: "bd-radio-label-wrap" },
          react.createElement("div", { className: "bd-radio-label" }, option.name),
          react.createElement("div", { className: "bd-radio-description" }, option.description),
        ),
      );
    });

    return react.createElement(
      "div",
      { className: `bd-radio-group${disabled ? " bd-radio-disabled" : ""}` },
      ...children,
    );
  };
}

export interface SearchProps {
  value?: string;
  defaultValue?: string;
  className?: string;
  placeholder?: string;
  max?: number;
  onKeyDown?: (event: unknown) => void;
  onChange?: (value: string) => void;
  disabled?: boolean;
  [key: string]: unknown;
}

/** BD's search input (`Search`). */
export function createSearch(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  const Button = createButton(react);
  const SearchIcon = createIcon(react, "search");
  const XIcon = createIcon(react, "x");
  return (props: SearchProps) => {
    const { className, onKeyDown, placeholder, max = 50 } = props;
    const { state, setState, disabled } = useItemProps<string, string | ChangeEvent>(
      props,
      (value) => (typeof value === "object" ? value.currentTarget.value : value),
    );

    const children: unknown[] = [
      react.createElement("input", {
        disabled,
        onChange: (event: ChangeEvent) => {
          setState(event);
        },
        onKeyDown,
        type: "text",
        className: "bd-search",
        placeholder,
        maxLength: max,
        value: state,
      }),
    ];
    if (!state) children.push(SearchIcon({ size: 18 }));
    else {
      children.push(
        Button({
          look: BUTTON_LOOKS.BLANK,
          color: BUTTON_COLORS.TRANSPARENT,
          size: BUTTON_SIZES.NONE,
          onClick: () => {
            if (disabled) return;
            setState("");
          },
          children: XIcon({ size: 16 }),
        }),
      );
    }
    return react.createElement(
      "div",
      { className: cx("bd-search-wrapper", disabled && "bd-search-disabled", className) },
      ...children,
    );
  };
}

export interface SliderMarker {
  value: number;
  label: string;
}

export interface SliderProps {
  value?: number;
  defaultValue?: number;
  min: number;
  max: number;
  step?: number;
  units?: string;
  markers?: (number | SliderMarker)[];
  onChange?: (value: number) => void;
  disabled?: boolean;
  [key: string]: unknown;
}

/** BD's slider input (`Slider`). */
export function createSlider(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  return (props: SliderProps) => {
    const { min, max, step, units = "", markers = [] } = props;
    const { state, setState, disabled } = useItemProps<number, number | ChangeEvent>(
      props,
      (value) => (typeof value === "object" ? value.currentTarget.valueAsNumber : value),
    );

    const percent = (value: number): number => ((value - min) * 100) / (max - min);
    const slope = (-62.5 - -25) / (max - min);
    const labelOffset = Math.max(-62.5, state * slope + -25);

    const markerElements =
      markers.length > 0
        ? [
            react.createElement(
              "div",
              { key: "marker-container", className: "bd-slider-marker-container" },
              ...markers.map((marker, index) => {
                const value = typeof marker === "number" ? marker : marker.value;
                const label = typeof marker === "number" ? marker : marker.label;
                const showUnits = Boolean(units) && typeof marker === "number";
                return react.createElement(
                  "div",
                  {
                    key: index,
                    className: "bd-slider-marker",
                    style: { left: `${String(percent(value))}%` },
                    onClick: () => {
                      setState(value);
                    },
                  },
                  `${String(label)}${showUnits ? units : ""}`,
                );
              }),
            ),
          ]
        : [];

    return react.createElement(
      "div",
      {
        className: `bd-slider-wrap ${disabled ? "bd-slider-disabled" : ""} ${
          markers.length > 0 ? "bd-slider-markers" : ""
        }`,
      },
      react.createElement("input", {
        onChange: (event: ChangeEvent) => {
          setState(event);
        },
        type: "range",
        className: "bd-slider-input",
        min,
        max,
        step,
        value: state,
        disabled,
      }),
      react.createElement(
        "div",
        {
          className: "bd-slider-label",
          style: {
            left: `${String(percent(state))}%`,
            transform: `translateX(${String(labelOffset)}%)`,
          },
        },
        `${String(state)}${units}`,
      ),
      react.createElement("div", {
        className: "bd-slider-track",
        style: { backgroundSize: `${String(percent(state))}% 100%` },
      }),
      ...markerElements,
    );
  };
}

export interface KeybindProps {
  value?: string[];
  defaultValue?: string[];
  /** Receives the recorded combination; an empty array means cleared. */
  onChange?: (value: string[]) => void;
  max?: number;
  clearable?: boolean;
  disabled?: boolean;
  [key: string]: unknown;
}

/** A keyboard event as the recorder consumes it. */
interface KeyEvent {
  repeat: boolean;
  key: string;
  stopImmediatePropagation(): void;
  stopPropagation(): void;
  preventDefault(): void;
}

/** BD's keybind recorder (`Keybind`). */
export function createKeybind(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  const useCallbackRef = useCallbackRefFor(react);
  const Button = createButton(react);
  const KeyboardIcon = createIcon(react, "keyboard");
  const XIcon = createIcon(react, "x");
  return (props: KeybindProps) => {
    const { max = 4, clearable = false } = props;
    // An uncontrolled recorder has neither value nor defaultValue, so the
    // state type carries the missing case explicitly.
    const { state, setState, disabled } = useItemProps<string[], string[] | undefined>(props);

    const [isRecording, setRecording] = react.useState(false);
    const accum = react.useRef<string[]>([]);

    const dispatch = (): void => {
      setRecording(false);
      try {
        setState(accum.current.concat());
      } finally {
        accum.current.length = 0;
      }
    };

    const keyDownHandler = useCallbackRef((event: KeyEvent) => {
      if (!isRecording) return;
      event.stopImmediatePropagation();
      event.stopPropagation();
      event.preventDefault();
      if (event.repeat || accum.current.includes(event.key)) return;
      accum.current.push(event.key);
      if (accum.current.length >= max) dispatch();
    });

    const keyUpHandler = useCallbackRef((event: KeyEvent) => {
      if (!isRecording) return;
      event.stopImmediatePropagation();
      event.stopPropagation();
      event.preventDefault();
      if (event.key === accum.current[0]) dispatch();
    });

    react.useEffect(() => {
      window.addEventListener("keydown", keyDownHandler, true);
      window.addEventListener("keyup", keyUpHandler, true);
      return () => {
        window.removeEventListener("keydown", keyDownHandler, true);
        window.removeEventListener("keyup", keyUpHandler, true);
      };
    }, [keyDownHandler, keyUpHandler]);

    // An uncontrolled recorder has neither value nor defaultValue, so the
    // rendered state may be missing even though the binding's type is T.
    const keys = state as string[] | undefined;
    const displayValue = !keys?.length
      ? ""
      : keys.map((key) => (key === "Control" ? "Ctrl" : key)).join(" + ");

    const toggleRecording = (): void => {
      if (disabled) return;
      accum.current.length = 0;
      setRecording((value) => !value);
    };

    const children: unknown[] = [
      Button({
        size: BUTTON_SIZES.ICON,
        look: BUTTON_LOOKS.FILLED,
        color: isRecording ? BUTTON_COLORS.RED : BUTTON_COLORS.PRIMARY,
        className: "bd-keybind-record",
        onClick: toggleRecording,
        children: KeyboardIcon({ size: 24 }),
      }),
      react.createElement("input", {
        readOnly: true,
        type: "text",
        className: "bd-keybind-input",
        value: displayValue,
        placeholder: "No keybind set",
        disabled,
      }),
    ];
    if (clearable) {
      children.push(
        Button({
          size: BUTTON_SIZES.ICON,
          look: BUTTON_LOOKS.BLANK,
          onClick: () => {
            if (disabled) return;
            dispatch();
          },
          className: "bd-keybind-clear",
          children: XIcon({ size: 24 }),
        }),
      );
    }

    return react.createElement(
      "div",
      {
        className: `bd-keybind-wrap${isRecording ? " recording" : ""}${
          disabled ? " bd-keybind-disabled" : ""
        }`,
        onClick: toggleRecording,
      },
      ...children,
    );
  };
}

export interface SelectOption {
  id?: string;
  value: unknown;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value?: unknown;
  defaultValue?: unknown;
  style?: "transparent" | "default";
  onChange?: (value: unknown) => void;
  disabled?: boolean;
  [key: string]: unknown;
}

/** BD's dropdown (`Dropdown`) — Discord's popover API plus an option list. */
export function createDropdown(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  const ChevronDownIcon = createIcon(react, "chevronDown");
  return (props: SelectProps) => {
    const { options, style } = props;
    const { state, setState, disabled } = useItemProps<unknown>(props);

    const [, setIsOpen] = react.useState(false);
    const selectRef = react.useRef<HTMLButtonElement | null>(null);
    const optionsRef = react.useRef<HTMLUListElement | null>(null);

    const change = (value: unknown): void => {
      setState(value);
      optionsRef.current?.togglePopover(false);
    };

    react.useLayoutEffect(() => {
      const selectButton = selectRef.current;
      const optionsPopover = optionsRef.current;
      if (!selectButton || !optionsPopover) return undefined;

      selectButton.popoverTargetElement = optionsPopover;
      selectButton.popoverTargetAction = "toggle";

      const observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) optionsPopover.togglePopover(false);
      });
      observer.observe(selectButton);
      return () => {
        observer.unobserve(selectButton);
      };
    }, []);

    // `?? options[0]` is upstream's double failsafe for a missing value.
    const selected = options.find((option) => option.value == state) ?? options[0];

    return react.createElement(
      react.Fragment,
      {},
      react.createElement(
        "button",
        {
          ref: selectRef,
          type: "button",
          className: cx(
            "bd-select",
            disabled && "bd-select-disabled",
            style == "transparent" && "bd-select-transparent",
          ),
          disabled,
        },
        react.createElement("span", { className: "bd-select-value" }, selected?.label),
        ChevronDownIcon({ size: 16, className: "bd-select-arrow" }),
      ),
      react.createElement(
        "ul",
        {
          ref: optionsRef,
          onToggle: (event: { newState?: string }) => {
            setIsOpen(event.newState === "open");
          },
          popover: "auto",
          role: "listbox",
          className: "bd-select-options bd-scroller-thin",
        },
        ...options.map((option) =>
          react.createElement(
            "li",
            {
              key: String(option.id ?? option.value),
              className: cx("bd-select-option", selected?.value == option.value && "selected"),
              role: "option",
              onClick: () => {
                change(option.value);
              },
            },
            option.label,
          ),
        ),
      ),
    );
  };
}

export interface ColorPickerProps {
  colors?: number[];
  defaultColor?: number;
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  [key: string]: unknown;
}

/** Resolves hex/number colors the way upstream's color utils do. */
function resolveColor(color: unknown, hex: boolean): string | number {
  if (typeof color === "number") return hex ? `#${color.toString(16)}` : color;
  if (typeof color === "string") {
    return hex ? color : Number.parseInt(color.replace("#", ""), 16);
  }
  return color as never;
}

/** Relative luminance → black/white foreground for a swatch. */
function contrastColor(color: string | number): string {
  let channels = [0, 0, 0];
  if (typeof color === "string") {
    const rgb = /#([a-fA-F0-9]{2})([a-fA-F0-9]{2})([a-fA-F0-9]{2})/.exec(color);
    const [, r, g, b] = rgb ?? [];
    if (r !== undefined && g !== undefined && b !== undefined) {
      channels = [r, g, b].map((part) => Number.parseInt(part, 16));
    }
  }
  const [r = 0, g = 0, b = 0] = channels;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma >= 150 ? "#000" : "#fff";
}

const DEFAULT_COLORS = [
  1752220, 3066993, 3447003, 10181046, 15277667, 15844367, 15105570, 15158332, 9807270, 6323595,
  1146986, 2067276, 2123412, 7419530, 11342935, 12745742, 11027200, 10038562, 9936031, 5533306,
];

/** BD's color input (`ColorPicker`) with default + custom swatches. */
export function createColorInput(react: ComponentsReact) {
  const useItemProps = createUseItemProps(react);
  const CheckIcon = createIcon(react, "check");
  const PipetteIcon = createIcon(react, "pipette");
  return (props: ColorPickerProps) => {
    const { colors = DEFAULT_COLORS, defaultColor } = props;
    const { state, setState, disabled } = useItemProps<number, number | ChangeEvent>(
      props,
      (value) =>
        resolveColor(typeof value === "object" ? value.currentTarget.value : value, true) as number,
    );

    const intValue = resolveColor(state, false) as number;
    const hexValue = resolveColor(state, true) as string;

    const Tooltip = tooltipComponent() as
      ((props: { text?: string; position?: string; children?: unknown }) => unknown) | undefined;

    const withTooltip = (
      text: string,
      child: (tooltipProps: Record<string, unknown>) => unknown,
    ): unknown => {
      if (!Tooltip) return child({});
      return Tooltip({ text, position: "bottom", children: child });
    };

    const controls: unknown[] = [];
    if (defaultColor !== undefined) {
      controls.push(
        withTooltip("Default", (tooltipProps) =>
          react.createElement(
            "div",
            {
              ...tooltipProps,
              className: "bd-color-picker-default",
              style: { backgroundColor: resolveColor(defaultColor, true) },
              onClick: () => {
                setState(defaultColor);
              },
            },
            intValue === resolveColor(defaultColor, false)
              ? CheckIcon({ size: 25, color: contrastColor(resolveColor(defaultColor, true)) })
              : null,
          ),
        ),
      );
    }
    controls.push(
      withTooltip("Custom Color", (tooltipProps) =>
        react.createElement(
          "div",
          { ...tooltipProps, className: "bd-color-picker-custom" },
          PipetteIcon({ size: 14, color: contrastColor(hexValue) }),
          react.createElement("input", {
            style: { backgroundColor: hexValue },
            type: "color",
            className: "bd-color-picker",
            value: hexValue,
            onChange: (event: ChangeEvent) => {
              setState(event);
            },
            disabled,
          }),
        ),
      ),
    );

    const swatches = colors.map((color, index) =>
      react.createElement(
        "div",
        {
          key: index,
          className: "bd-color-picker-swatch-item",
          style: { backgroundColor: resolveColor(color, true) },
          onClick: () => {
            setState(color);
          },
        },
        intValue === color
          ? CheckIcon({ size: 16, color: contrastColor(resolveColor(color, true)) })
          : null,
      ),
    );

    return react.createElement(
      "div",
      { className: `bd-color-picker-container${disabled ? " bd-color-picker-disabled" : ""}` },
      react.createElement("div", { className: "bd-color-picker-controls" }, ...controls),
      swatches.length > 0
        ? react.createElement("div", { className: "bd-color-picker-swatch" }, ...swatches)
        : null,
    );
  };
}
