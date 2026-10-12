import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import { builtinModules } from "node:module";
import tseslint from "typescript-eslint";
import type { Linter } from "eslint";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

interface RestrictedPattern {
  readonly group: readonly string[];
  readonly message: string;
}

const platformNeutralImports = (extra: readonly RestrictedPattern[] = []): Linter.RuleEntry => [
  "error",
  {
    patterns: [
      {
        group: ["electron", "electron/*", "node:*", "@ion/shell-*", ...nodeBuiltins],
        message:
          "Platform-neutral code must not import Electron, Node built-ins, or shell packages.",
      },
      ...extra,
    ],
  },
];

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/release/**",
      "**/coverage/**",
      // Verbatim upstream copies: provenance and formatting are pinned by
      // `tools/vendor.mjs --check`, not by our lint rules.
      "packages/compat-vencord/vendor/**",
    ],
  },
  {
    extends: [js.configs.recommended],
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      "no-empty": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    // The shell (main + preload) legitimately reports to stdout/devtools.
    files: ["packages/shell-desktop/src/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // A global ambient declaration file cannot use top-level imports — they
    // would turn it into a module and break the `declare module` blocks it
    // exists to host — so its references use inline `import()` types.
    files: ["packages/compat-vencord/src/vendor-modules.d.ts"],
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": platformNeutralImports([
        {
          group: ["@ion/!(plugin-*)"],
          message: "@ion/core only depends on built-in @ion/plugin-* packages.",
        },
      ]),
    },
  },
  {
    files: [
      "packages/ui/**/*.{ts,tsx}",
      "packages/compat-vencord/**/*.ts",
      "packages/compat-bd/**/*.ts",
      "packages/compat-shelter/**/*.ts",
      "plugins/**/*.ts",
    ],
    rules: { "no-restricted-imports": platformNeutralImports() },
  },
  prettier,
);
