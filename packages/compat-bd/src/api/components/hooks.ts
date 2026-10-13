/**
 * `useCallbackRef` from upstream's `@ui/hooks` (Apache-2.0 — see
 * THIRD_PARTY.md): a stable proxy identity whose invocations always call
 * the latest callback. Ported verbatim in behavior; only React is passed
 * in instead of imported.
 */

import type { ComponentsReact } from "./runtime";

type AnyFn = (...args: never[]) => unknown;

/** A stable wrapper that forwards every call/property access to the latest callback. */
export function useCallbackRefFor(react: ComponentsReact) {
  return function useCallbackRef<T extends AnyFn>(callback: T): T {
    const ref = react.useRef(callback);

    ref.current = callback;

    return react.useMemo(() => {
      const handler: ProxyHandler<T> = {
        get(_target, property, receiver) {
          if (property === Symbol.for("callback")) return ref.current;
          return Reflect.get(ref.current, property, receiver) as unknown;
        },
        apply(_target, _thisArg, args) {
          return Reflect.apply(ref.current, _thisArg, args) as unknown;
        },
      };

      return new Proxy(ref.current, handler);
    }, []);
  };
}
