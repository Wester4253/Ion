/**
 * React helpers shared by the BetterDiscord facade. Port of the
 * `getType` resolver from BetterDiscord's src/betterdiscord/utils/react.ts
 * (Apache-2.0, see THIRD_PARTY.md): unwraps React's exotic wrappers
 * (memo, forwardRef, resolved lazy) down to the component function.
 */

const exoticComponents = {
  memo: Symbol.for("react.memo"),
  forwardRef: Symbol.for("react.forward_ref"),
  lazy: Symbol.for("react.lazy"),
} as const;

interface ReactElement {
  readonly $$typeof?: symbol;
  readonly type?: unknown;
  readonly render?: unknown;
  readonly _payload?: { _status?: number; _result?: { default?: unknown } | undefined } | undefined;
}

export function getType(elementType: unknown): unknown {
  let current = elementType;
  for (;;) {
    if (current == null || typeof current !== "object") return current;
    const element = current as ReactElement;
    const kind = element.$$typeof;
    if (kind === exoticComponents.memo) {
      current = element.type;
    } else if (kind === exoticComponents.forwardRef) {
      current = element.render;
    } else if (kind === exoticComponents.lazy) {
      const payload = element._payload;
      // Status 1 is React's "resolved" state; unresolved lazy values have
      // no usable component yet, so upstream substitutes a no-op.
      current = payload?._status === 1 ? payload._result?.default : (): undefined => undefined;
    } else {
      return current;
    }
  }
}
