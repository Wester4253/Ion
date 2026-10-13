/**
 * Unit tests for page-side plugin evaluation: the CommonJS shim, the
 * default-export unwrap, the throwing `require`, and upstream's
 * class-vs-factory instantiation rule.
 */

import { describe, expect, it } from "vitest";

import { evaluatePluginModule, instantiatePlugin, type BdPluginExport } from "./evaluate";
import type { BdAddonMeta } from "./meta";

const META: BdAddonMeta = {
  name: "EvalPlugin",
  version: "1.0.0",
  description: "evaluation fixture",
  author: "Tester",
  runAt: "connection",
  filename: "EvalPlugin.plugin.js",
};

const FOLDER = "bd/plugins";

describe("evaluatePluginModule", () => {
  it("hands the shim the filename, folder, and exports object", () => {
    const exported = evaluatePluginModule(
      "module.exports = [__filename, __dirname, typeof exports, typeof module];",
      META.filename,
      FOLDER,
    );
    expect(exported).toEqual(["EvalPlugin.plugin.js", "bd/plugins", "object", "object"]);
  });

  it("unwraps an ESM default export", () => {
    const exported = evaluatePluginModule(
      "module.exports.default = class { start() {} stop() {} };",
      META.filename,
      FOLDER,
    );
    expect(typeof exported).toBe("function");
    expect(instantiatePlugin(exported as BdPluginExport, META)).toBeDefined();
  });

  it("fails loudly when a plugin requires a Node module", () => {
    expect(() =>
      evaluatePluginModule('module.exports = require("electron");', META.filename, FOLDER),
    ).toThrow('require("electron") is not available');
  });

  it("throws on a syntax error", () => {
    expect(() => evaluatePluginModule("module.exports = class {", META.filename, FOLDER)).toThrow(
      SyntaxError,
    );
  });
});

describe("instantiatePlugin", () => {
  it("constructs class exports with new and passes the meta", () => {
    const exported = evaluatePluginModule(
      "module.exports = class { constructor(meta) { this.meta = meta; } start() {} stop() {} };",
      META.filename,
      FOLDER,
    );
    expect(typeof exported).toBe("function");
    const instance = instantiatePlugin(exported as BdPluginExport, META);
    expect((instance as unknown as { meta: BdAddonMeta }).meta).toBe(META);
  });

  it("calls prototype-less factories directly", () => {
    const exported = evaluatePluginModule(
      "module.exports = (meta) => ({ name: meta.name, start() {}, stop() {} });",
      META.filename,
      FOLDER,
    );
    const instance = instantiatePlugin(exported as BdPluginExport, META);
    expect((instance as unknown as { name: string }).name).toBe("EvalPlugin");
  });
});
