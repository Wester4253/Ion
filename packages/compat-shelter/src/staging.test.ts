/**
 * Unit tests for staged-plugin discovery: the profile directory is the
 * source of truth, an absent one is "nothing installed", and a directory
 * that cannot be read comes back as a failure rather than disappearing —
 * otherwise a broken install would be indistinguishable from a plugin the
 * user never added.
 */

import { describe, expect, it } from "vitest";
import type { ShellHost } from "@ion/core";

import { readStagedPlugins, shelterPluginIdFor, SHELTER_PLUGIN_ROOT } from "./staging";

/** A shell whose file API serves one in-memory tree and directory listing. */
function shimmedShell(
  files: Record<string, string>,
  directories: Record<string, string[]>,
): ShellHost {
  return {
    files: {
      readdir: (path: string): Promise<string[]> => {
        const entries = directories[path];
        return entries === undefined
          ? Promise.reject(new Error(`ENOENT: ${path}`))
          : Promise.resolve(entries);
      },
      readFile: (path: string): Promise<string> => {
        const content = files[path];
        return content === undefined
          ? Promise.reject(new Error(`ENOENT: ${path}`))
          : Promise.resolve(content);
      },
    },
  } as unknown as ShellHost;
}

describe("shelterPluginIdFor", () => {
  it("names the plugin after the folder the index and the harness use", () => {
    expect(shelterPluginIdFor("blur-nsfw")).toBe("shelter.blur-nsfw");
  });
});

describe("readStagedPlugins", () => {
  it("returns nothing when the shell bridge is absent", async () => {
    await expect(readStagedPlugins(undefined)).resolves.toEqual([]);
  });

  it("returns nothing when no plugin root exists", async () => {
    const shell = shimmedShell({}, {});
    await expect(readStagedPlugins(shell)).resolves.toEqual([]);
  });

  it("reads a manifest and its code as one plugin", async () => {
    const shell = shimmedShell(
      {
        [`${SHELTER_PLUGIN_ROOT}/antitrack/plugin.json`]: JSON.stringify({ name: "Antitrack" }),
        [`${SHELTER_PLUGIN_ROOT}/antitrack/plugin.js`]: "({ onLoad() {} })",
      },
      { [SHELTER_PLUGIN_ROOT]: ["antitrack"] },
    );

    await expect(readStagedPlugins(shell)).resolves.toEqual([
      {
        folder: "antitrack",
        hostId: "shelter.antitrack",
        ok: true,
        manifestJson: JSON.stringify({ name: "Antitrack" }),
        js: "({ onLoad() {} })",
      },
    ]);
  });

  it("reports a directory it cannot read instead of skipping it", async () => {
    const shell = shimmedShell(
      {
        [`${SHELTER_PLUGIN_ROOT}/good/plugin.json`]: "{}",
        [`${SHELTER_PLUGIN_ROOT}/good/plugin.js`]: "({})",
      },
      { [SHELTER_PLUGIN_ROOT]: ["good", "half-installed"] },
    );

    const staged = await readStagedPlugins(shell);
    expect(staged).toHaveLength(2);

    const broken = staged.find((entry) => entry.folder === "half-installed");
    expect(broken?.ok).toBe(false);
    if (broken?.ok === false) {
      expect(broken.hostId).toBe("shelter.half-installed");
      expect(broken.reason).toContain("could not be read");
      expect(broken.reason).toContain("half-installed/plugin.json");
    }
  });

  it("reports missing code separately from a missing manifest", async () => {
    const shell = shimmedShell(
      { [`${SHELTER_PLUGIN_ROOT}/codeless/plugin.json`]: "{}" },
      { [SHELTER_PLUGIN_ROOT]: ["codeless"] },
    );

    const staged = await readStagedPlugins(shell);
    expect(staged).toHaveLength(1);
    expect(staged[0]?.ok).toBe(false);
    if (staged[0]?.ok === false) {
      expect(staged[0].reason).toContain("codeless/plugin.js");
    }
  });

  it("ignores editor droppings and orders results by folder", async () => {
    const shell = shimmedShell(
      {
        [`${SHELTER_PLUGIN_ROOT}/zebra/plugin.json`]: "{}",
        [`${SHELTER_PLUGIN_ROOT}/zebra/plugin.js`]: "({})",
        [`${SHELTER_PLUGIN_ROOT}/apple/plugin.json`]: "{}",
        [`${SHELTER_PLUGIN_ROOT}/apple/plugin.js`]: "({})",
      },
      { [SHELTER_PLUGIN_ROOT]: [".DS_Store", "zebra", "apple"] },
    );

    const staged = await readStagedPlugins(shell);
    expect(staged.map((entry) => entry.folder)).toEqual(["apple", "zebra"]);
  });
});
