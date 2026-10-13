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

  it("provides EventEmitter through require('events')", () => {
    const exported = evaluatePluginModule(
      `const { EventEmitter } = require("events");
       class Store extends EventEmitter {}
       const store = new Store();
       let seen = null;
       store.on("change", (value) => { seen = value; });
       store.emit("change", 42);
       module.exports = { seen, count: store.listenerCount("change"), names: store.eventNames() };`,
      META.filename,
      FOLDER,
    ) as { seen: number; count: number; names: string[] };
    expect(exported.seen).toBe(42);
    expect(exported.count).toBe(1);
    expect(exported.names).toEqual(["change"]);
  });

  it("emits through the ESM default namespace like a transpiled import", () => {
    // BlurNSFW does `__toESM(require("events"), 1)` and calls
    // `new import_events.default()`. For a CommonJS module that helper sets
    // `default` to `module.exports`, so the export has to *be* the class —
    // an object carrying its own `default` yields a non-constructor.
    const exported = evaluatePluginModule(
      `const import_events = { default: require("events") };
       const bus = new import_events.default();
       let seen = 0;
       bus.on("tick", () => { seen++; });
       bus.emit("tick");
       module.exports = seen;`,
      META.filename,
      FOLDER,
    );
    expect(exported).toBe(1);
  });

  it("detaches once() listeners after their first emission", () => {
    const exported = evaluatePluginModule(
      `const { EventEmitter } = require("events");
       const bus = new EventEmitter();
       let count = 0;
       bus.once("tick", () => { count++; });
       bus.emit("tick");
       bus.emit("tick");
       module.exports = { count, left: bus.listenerCount("tick") };`,
      META.filename,
      FOLDER,
    ) as { count: number; left: number };
    expect(exported).toEqual({ count: 1, left: 0 });
  });

  it("returns false when emitting with no listeners, and true when one ran", () => {
    const exported = evaluatePluginModule(
      `const { EventEmitter } = require("events");
       const bus = new EventEmitter();
       const silent = bus.emit("nobody");
       let ran = false;
       bus.on("x", () => { ran = true; });
       module.exports = { silent, loud: bus.emit("x"), ran };`,
      META.filename,
      FOLDER,
    ) as { silent: boolean; loud: boolean; ran: boolean };
    expect(exported).toEqual({ silent: false, loud: true, ran: true });
  });

  it("throws on an unhandled 'error' emission, like Node does", () => {
    expect(() =>
      evaluatePluginModule(
        `const { EventEmitter } = require("events");
         new EventEmitter().emit("error", new Error("boom"));`,
        META.filename,
        FOLDER,
      ),
    ).toThrow("Unhandled 'error' event");
  });

  it("throws by name for the members it does not implement", () => {
    // The reason must not claim the module is unavailable — `events` did
    // resolve; this specific member is what is missing.
    expect(() =>
      evaluatePluginModule(
        `const { EventEmitter } = require("events");
         new EventEmitter().prependListener("x", () => {});`,
        META.filename,
        FOLDER,
      ),
    ).toThrow("prependListener");
  });

  it("fails loudly when a plugin requires a Node module", () => {
    expect(() =>
      evaluatePluginModule('module.exports = require("electron");', META.filename, FOLDER),
    ).toThrow('require("electron") is not available');
    expect(() =>
      evaluatePluginModule('module.exports = require("fs");', META.filename, FOLDER),
    ).toThrow('require("fs") is not available');
    expect(() =>
      evaluatePluginModule('module.exports = require("path");', META.filename, FOLDER),
    ).toThrow('require("path") is not available');
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
