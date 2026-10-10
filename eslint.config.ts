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
  { ignores: ["**/dist/**", "**/out/**", "**/release/**", "**/coverage/**"] },
  {
    extends: [js.configs.recommended],
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.ts"],
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
    // The main process legitimately logs to stdout for diagnostics.
    files: ["packages/shell-desktop/src/main/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": platformNeutralImports([
        { group: ["@ion/*"], message: "@ion/core depends on nothing else in the monorepo." },
      ]),
    },
  },
  {
    files: [
      "packages/ui/**/*.ts",
      "packages/compat-vencord/**/*.ts",
      "packages/compat-bd/**/*.ts",
      "packages/compat-shelter/**/*.ts",
      "plugins/**/*.ts",
    ],
    rules: { "no-restricted-imports": platformNeutralImports() },
  },
  prettier,
);
