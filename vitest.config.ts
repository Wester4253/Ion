import { transformAsync } from "@babel/core";
import ts from "@babel/preset-typescript";
import solid from "babel-preset-solid";
import { defineConfig, type Plugin } from "vitest/config";

/** The adapter's JSX and the library it compiles, by path. */
const SOLID_SOURCES = ["/packages/compat-shelter/", "@uwu/shelter-ui"];

/** The package's own map describes its untransformed source; drop it. */
const PACKAGE_SOURCE_MAP = /^\/\/# sourceMappingURL=.*$/gm;

/**
 * Compiles Solid JSX with Solid's own transform, in tests and in the bundle
 * alike.
 *
 * esbuild cannot do Solid's transform — that is why the app build runs
 * babel-preset-solid — and in Vitest it is what would otherwise handle
 * these files: for `@uwu/shelter-ui`, whose build output deliberately keeps
 * its JSX for its consumer, esbuild's default factory produces
 * `React.createElement`; for the adapter's own `.tsx`, Vite honours
 * `jsxImportSource` from the tsconfig and emits `jsxDEV`, which solid-js
 * 1.6.16's runtime entry does not export. Both fail at the moment a
 * component renders, which is exactly the moment a green test should be
 * about the component.
 *
 * Compiling the same files with the same presets here is the whole point:
 * a passing settings-modal test has to mean the dialog Ion opens.
 */
function solidTsx(): Plugin {
  return {
    name: "ion:solid-tsx",
    enforce: "pre",
    async transform(code, id) {
      if (!SOLID_SOURCES.some((match) => id.includes(match))) return null;

      const result = await transformAsync(code.replace(PACKAGE_SOURCE_MAP, ""), {
        presets: [solid, ts],
        parserOpts: { plugins: ["jsx"] },
        filename: id,
        sourceMaps: true,
      });
      if (result?.code == null) throw new Error(`could not compile Solid JSX: ${id}`);
      return { code: result.code, map: result.map ?? undefined };
    },
  };
}

export default defineConfig({
  plugins: [solidTsx()],
  // Tests load the browser builds of every dependency, which is what the app
  // itself loads: `solid-js/web` ships a server build with no `template()`
  // and no effects, so resolving it by Node's conditions would render the
  // settings modal through an API that never mounts anything. Vite's server
  // defaults drop `browser`; keeping both leaves every other package on the
  // resolution it already had.
  resolve: { conditions: ["module", "browser", "node", "development|production"] },
  ssr: { resolve: { conditions: ["module", "browser", "node", "development|production"] } },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}", "plugins/*/src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
