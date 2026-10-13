/**
 * `useItemProps` — upstream's `@ui/settings/components/utils`
 * (Apache-2.0 — see THIRD_PARTY.md): the controlled/uncontrolled state
 * binding every ported input component shares. `useSettingsContext` is
 * inlined against the lazily created context.
 *
 * Upstream types each input's props as a strict value/defaultValue union;
 * real plugins pass looser objects, so the binding takes the union's
 * structural shape directly — identical runtime behavior, no casts.
 */

import { settingsContext, type SettingsContextValue } from "./context";
import { useCallbackRefFor } from "./hooks";
import type { ComponentsReact } from "./runtime";

export interface SettingProps<T> {
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  disabled?: boolean;
}

export interface HandledValue<T, V> {
  disabled: boolean | undefined;
  state: T;
  original: T;
  setState: (value: V, stateOnly?: boolean) => void;
}

/** The `useItemProps` hook, bound to a React instance and the settings context. */
export function createUseItemProps(react: ComponentsReact) {
  const useCallbackRef = useCallbackRefFor(react);

  return function useItemProps<T, V = T>(
    props: SettingProps<T>,
    convertValue: (newValue: V, currentValue: T) => T = (value) => value as unknown as T,
  ): HandledValue<T, V> {
    const ctx = react.useContext<SettingsContextValue>(settingsContext(react));
    const usesDefaultValue = react.useState(() => !("value" in props))[0];
    const [internalState, setState] = react.useState<T | undefined>(props.defaultValue);

    const [original] = react.useState(
      () => (ctx.fail ? (usesDefaultValue ? props.defaultValue : props.value) : ctx.value) as T,
    );

    const change = useCallbackRef((value: V, stateOnly?: boolean) => {
      if (ctx.fail ? props.disabled : ctx.disabled) return;

      const current = ctx.fail ? (usesDefaultValue ? internalState : props.value) : ctx.value;
      const out = convertValue(value, current as T);

      if (!stateOnly) props.onChange?.(out);

      setState(out);
    });

    if (!ctx.fail) {
      return {
        original,
        disabled: ctx.disabled,
        state: ctx.value as T,
        setState: change,
      };
    }

    return {
      original,
      disabled: props.disabled,
      state: (usesDefaultValue ? internalState : props.value) as T,
      setState: change,
    };
  };
}
