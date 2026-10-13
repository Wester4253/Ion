/**
 * Base `BdApi.Components` primitives, ported from upstream's
 * `@ui/base/{text,flex,button}`, `@ui/spinner`, and `@ui/divider`
 * (Apache-2.0 — see THIRD_PARTY.md). JSX is replaced with explicit
 * `createElement` calls and `clsx` with `cx`, so the surface builds
 * against Discord's own React at call time with no extra dependencies.
 */

import { componentsReact, cx, type ComponentsReact } from "./runtime";
import { accessibilityContext } from "./lookups";

export const TEXT_COLORS = Object.freeze({
  STANDARD: "bd-text-normal",
  MUTED: "bd-text-muted",
  ERROR: "bd-text-error",
  BRAND: "bd-text-brand",
  LINK: "bd-text-link",
  HEADER_PRIMARY: "bd-header-primary",
  HEADER_SECONDARY: "bd-header-secondary",
  STATUS_YELLOW: "bd-text-yellow",
  STATUS_GREEN: "bd-text-green",
  STATUS_RED: "bd-text-red",
  ALWAYS_WHITE: "bd-text-white",
  CUSTOM: null,
});

export const TEXT_SIZES = Object.freeze({
  SIZE_10: "bd-text-10",
  SIZE_12: "bd-text-12",
  SIZE_14: "bd-text-14",
  SIZE_16: "bd-text-16",
  SIZE_20: "bd-text-20",
  SIZE_24: "bd-text-24",
  SIZE_32: "bd-text-32",
});

export interface TextProps {
  tag?: unknown;
  className?: string;
  color?: string | null;
  size?: string;
  selectable?: boolean;
  strong?: boolean;
  style?: Record<string, unknown>;
  children?: unknown;
  [key: string]: unknown;
}

export interface TextComponent {
  (props: TextProps): unknown;
  readonly Colors: typeof TEXT_COLORS;
  readonly Sizes: typeof TEXT_SIZES;
}

/** BD's typography element (`Text`). */
export function createText(react: ComponentsReact): TextComponent {
  const Text = ((props: TextProps) => {
    const {
      tag = "div",
      className = "",
      children = null,
      color = TEXT_COLORS.STANDARD,
      size = TEXT_SIZES.SIZE_14,
      selectable,
      strong,
      style,
      ...rest
    } = props;
    return react.createElement(
      tag,
      {
        className: cx(color, size, className, {
          "bd-selectable": selectable,
          "bd-text-strong": strong,
        }),
        ...(style === undefined ? {} : { style }),
        ...rest,
      },
      children,
    );
  }) as TextComponent;
  return Object.assign(Text, { Colors: TEXT_COLORS, Sizes: TEXT_SIZES });
}

export const FLEX_DIRECTION = Object.freeze({
  VERTICAL: "bd-flex-vertical",
  HORIZONTAL: "bd-flex-horizontal",
  HORIZONTAL_REVERSE: "bd-flex-reverse",
});

export const FLEX_JUSTIFY = Object.freeze({
  START: "bd-flex-justify-start",
  END: "bd-flex-justify-end",
  CENTER: "bd-flex-justify-center",
  BETWEEN: "bd-flex-justify-between",
  AROUND: "bd-flex-justify-around",
});

export const FLEX_ALIGN = Object.freeze({
  START: "bd-flex-align-start",
  END: "bd-flex-align-end",
  CENTER: "bd-flex-align-center",
  STRETCH: "bd-flex-align-stretch",
  BASELINE: "bd-flex-align-baseline",
});

export const FLEX_WRAP = Object.freeze({
  NO_WRAP: "bd-flex-no-wrap",
  WRAP: "bd-flex-wrap",
  WRAP_REVERSE: "bd-flex-wrap-reverse",
});

export interface FlexProps {
  id?: string;
  className?: string;
  style?: Record<string, unknown>;
  shrink?: number;
  grow?: number;
  basis?: string;
  justify?: string;
  direction?: string;
  align?: string;
  wrap?: string;
  children?: unknown;
  [key: string]: unknown;
}

export interface FlexComponent {
  (props: FlexProps): unknown;
  readonly Child: (props: FlexProps) => unknown;
  readonly Direction: typeof FLEX_DIRECTION;
  readonly Align: typeof FLEX_ALIGN;
  readonly Justify: typeof FLEX_JUSTIFY;
  readonly Wrap: typeof FLEX_WRAP;
}

/** BD's flex container (`Flex`) with its direction/align/justify/wrap maps. */
export function createFlex(react: ComponentsReact): FlexComponent {
  const Flex = ((props: FlexProps) => {
    const {
      children,
      className,
      style,
      shrink = 1,
      grow = 1,
      basis = "auto",
      direction = FLEX_DIRECTION.HORIZONTAL,
      align = FLEX_ALIGN.STRETCH,
      justify = FLEX_JUSTIFY.START,
      wrap = FLEX_WRAP.NO_WRAP,
      ...rest
    } = props;
    return react.createElement(
      "div",
      {
        ...rest,
        className: cx("bd-flex", direction, justify, align, wrap, className),
        style: Object.assign({ flexShrink: shrink, flexGrow: grow, flexBasis: basis }, style),
      },
      children,
    );
  }) as FlexComponent;

  const FlexChild = (props: FlexProps) =>
    react.createElement(Flex, { ...props, className: cx(props.className, "bd-flex-child") });

  return Object.assign(Flex, {
    Child: FlexChild,
    Direction: FLEX_DIRECTION,
    Align: FLEX_ALIGN,
    Justify: FLEX_JUSTIFY,
    Wrap: FLEX_WRAP,
  });
}

export const BUTTON_LOOKS = Object.freeze({
  FILLED: "bd-button-filled",
  OUTLINED: "bd-button-outlined",
  LINK: "bd-button-link",
  BLANK: "bd-button-blank",
});

export const BUTTON_COLORS = Object.freeze({
  BRAND: "bd-button-color-brand",
  BLURPLE: "bd-button-color-blurple",
  RED: "bd-button-color-red",
  GREEN: "bd-button-color-green",
  YELLOW: "bd-button-color-yellow",
  PRIMARY: "bd-button-color-primary",
  LINK: "bd-button-color-link",
  WHITE: "bd-button-color-white",
  TRANSPARENT: "bd-button-color-transparent",
  CUSTOM: "",
});

export const BUTTON_SIZES = Object.freeze({
  NONE: "",
  TINY: "bd-button-tiny",
  SMALL: "bd-button-small",
  MEDIUM: "bd-button-medium",
  LARGE: "bd-button-large",
  ICON: "bd-button-icon",
});

export interface ButtonProps {
  className?: string;
  onClick?: (event: { preventDefault(): void; stopPropagation(): void }) => void;
  onKeyDown?: (event: unknown) => void;
  buttonRef?: { current: unknown };
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  look?: string;
  color?: string;
  size?: string;
  grow?: boolean;
  submitting?: boolean;
  children?: unknown;
  [key: string]: unknown;
}

export interface ButtonComponent {
  (props: ButtonProps): unknown;
  readonly Looks: typeof BUTTON_LOOKS;
  readonly Colors: typeof BUTTON_COLORS;
  readonly Sizes: typeof BUTTON_SIZES;
}

/** BD's button (`Button`) with its look/color/size maps and submit spinner. */
export function createButton(react: ComponentsReact): ButtonComponent {
  const Spinner = createSpinner(react);
  const Button = ((props: ButtonProps) => {
    const {
      className,
      children,
      onClick,
      onKeyDown,
      buttonRef,
      disabled = false,
      type = "button",
      look = BUTTON_LOOKS.FILLED,
      color = BUTTON_COLORS.BRAND,
      size = BUTTON_SIZES.MEDIUM,
      grow = true,
      submitting = false,
      ...others
    } = props;

    const handleClick = react.useCallback(
      (event: { preventDefault(): void; stopPropagation(): void }) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
      },
      [onClick],
    );

    return react.createElement(
      "button",
      {
        ...others,
        className: cx("bd-button", className, look, color, size, grow ? "bd-button-grow" : ""),
        ...(buttonRef === undefined ? {} : { ref: buttonRef }),
        type: type === "button" ? undefined : type,
        onClick: disabled ? () => undefined : handleClick,
        onKeyDown: disabled ? () => undefined : onKeyDown,
        disabled,
      },
      react.createElement(
        "div",
        { className: "bd-button-content" },
        submitting ? Spinner({ type: SPINNER_TYPES.PULSING_ELLIPSIS }) : children,
      ),
    );
  }) as ButtonComponent;

  return Object.assign(Button, {
    Looks: BUTTON_LOOKS,
    Colors: BUTTON_COLORS,
    Sizes: BUTTON_SIZES,
  });
}

export const SPINNER_TYPES = Object.freeze({
  WANDERING_CUBES: "wandering-cubes",
  CHASING_DOTS: "chasing-dots",
  PULSING_ELLIPSIS: "pulsing-ellipsis",
  SPINNING_CIRCLE: "spinning-circle",
  SPINNING_CIRCLE_SIMPLE: "spinning-circle-simple",
  LOW_MOTION: "low-motion",
});

export interface SpinnerProps {
  type?: string;
  animated?: boolean;
  className?: string;
  itemClassName?: string;
  "aria-label"?: string;
  [key: string]: unknown;
}

export interface SpinnerComponent {
  (props: SpinnerProps): unknown;
  readonly Type: typeof SPINNER_TYPES;
}

/** BD's spinner (`Spinner`) — a clone of Discord's builtin, incl. reduced-motion handling. */
export function createSpinner(react: ComponentsReact): SpinnerComponent {
  const context = accessibilityContext(react);
  const Spinner = ((props: SpinnerProps) => {
    const { reducedMotion } = react.useContext<{ reducedMotion?: { enabled?: boolean } }>(context);
    const { animated = true } = props;

    const type = react.useMemo(() => {
      const spinnerType = props.type ?? SPINNER_TYPES.WANDERING_CUBES;
      if (!reducedMotion?.enabled) return spinnerType;
      switch (spinnerType) {
        case SPINNER_TYPES.WANDERING_CUBES:
        case SPINNER_TYPES.CHASING_DOTS:
          return SPINNER_TYPES.LOW_MOTION;
        default:
          return spinnerType;
      }
    }, [props.type, reducedMotion?.enabled]);

    const className = react.useMemo(
      () =>
        cx(
          { "bd-spinner-stopAnimation": !animated },
          "bd-spinner",
          `bd-spinner-${type}`,
          props.className,
        ),
      [props.className, animated, type],
    );

    const itemClassName = react.useMemo(
      () => cx("bd-spinner-path", props.itemClassName),
      [props.itemClassName],
    );

    if (type === SPINNER_TYPES.SPINNING_CIRCLE || type === SPINNER_TYPES.SPINNING_CIRCLE_SIMPLE) {
      const circles: unknown[] = [
        react.createElement("circle", { cx: 50, cy: 50, r: 20, className: itemClassName }),
      ];
      if (type === SPINNER_TYPES.SPINNING_CIRCLE) {
        circles.unshift(
          react.createElement("circle", { cx: 50, cy: 50, r: 20, className: itemClassName }),
        );
      }
      return react.createElement(
        "div",
        { ...props, className, role: "img", "aria-label": props["aria-label"] },
        react.createElement(
          "div",
          { className: "bd-spinner-inner" },
          react.createElement(
            "svg",
            { className: "bd-spinner-circular", viewBox: "25 25 50 50" },
            ...circles,
          ),
        ),
      );
    }

    const items: unknown[] = [
      react.createElement("span", { className: itemClassName }),
      react.createElement("span", { className: itemClassName }),
    ];
    if (type === SPINNER_TYPES.PULSING_ELLIPSIS || type === SPINNER_TYPES.LOW_MOTION) {
      items.push(react.createElement("span", { className: itemClassName }));
    }
    return react.createElement(
      "span",
      { ...props, className, role: "img", "aria-label": props["aria-label"] },
      react.createElement("span", { className: "bd-spinner-inner" }, ...items),
    );
  }) as SpinnerComponent;

  return Object.freeze(Object.assign(Spinner, { Type: SPINNER_TYPES }));
}

export interface DividerProps {
  className?: string;
  [key: string]: unknown;
}

/** BD's horizontal divider (`Divider`). */
export function createDivider(react: ComponentsReact) {
  return (props: DividerProps) => {
    const { className, ...rest } = props;
    return react.createElement("hr", { ...rest, className: cx("bd-divider", className) });
  };
}

/** Re-export for consumers that only need the React probe. */
export { componentsReact };
