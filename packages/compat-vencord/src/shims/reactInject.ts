/*
 * JSX runtime for vendored Vencord components.
 *
 * Mirrors upstream's scripts/build/inject/react.mjs: esbuild injects these
 * bindings into every module scope, so JSX in the vendored sources compiles
 * to `VencordCreateElement(...)` calls that resolve Discord's React lazily
 * (the bundle evaluates before Discord's webpack exists).
 */

export const VencordFragment = /* #__PURE__*/ Symbol.for("react.fragment");

interface DiscordReact {
  createElement: (...args: unknown[]) => unknown;
}

function react(): DiscordReact {
  const common = (window as { Vencord?: { Webpack?: { Common?: { React?: DiscordReact } } } })
    .Vencord?.Webpack?.Common;
  if (!common?.React) {
    throw new Error("compat-vencord: Discord's React is not available yet (webpack not ready)");
  }
  return common.React;
}

export let VencordCreateElement: (...args: unknown[]) => unknown = (...args: unknown[]) => {
  VencordCreateElement = (...inner: unknown[]) => react().createElement(...inner);
  return VencordCreateElement(...args);
};
