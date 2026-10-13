/**
 * Types for the two Babel presets that ship none.
 *
 * `babel-preset-solid` and `@babel/preset-typescript` publish no `.d.ts`, so
 * `vitest.config.ts` — the only place Ion loads them — would be typed as
 * `any`. Babel's own preset shape is a function taking a Babel API object and
 * returning a preset object; declaring exactly that keeps the config checked
 * without pulling in an untyped import.
 *
 * `@babel/core` does ship types (`@types/babel__core`) and is not declared
 * here.
 */

declare module "babel-preset-solid" {
  import type { PluginItem } from "@babel/core";
  const preset: PluginItem;
  export default preset;
}

declare module "@babel/preset-typescript" {
  import type { PluginItem } from "@babel/core";
  const preset: PluginItem;
  export default preset;
}
