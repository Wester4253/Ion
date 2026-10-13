/**
 * Discovering installed Shelter plugins in the profile.
 *
 * Shelter stores each plugin as a directory holding `plugin.json` and
 * `plugin.js` — the same pair its index publishes and its own loader
 * fetches with `new URL("plugin.json", src)`. Ion stages that pair from
 * `<profile>/ion/shelter/plugins/<folder>/`, so the file system the shell
 * scopes is the single source of truth: no plugin list lives in page
 * storage, and the harness's provenance file maps one-to-one onto what the
 * client reads.
 *
 * A directory that cannot be read stays in the result as a failure rather
 * than disappearing: the manager registers it under its folder name and
 * fails it at start with the reason, so a broken install shows up on the
 * scoreboard instead of being indistinguishable from an uninstalled plugin.
 */

import type { ShellHost } from "@ion/core";

/** Profile-relative root every staged plugin lives under. */
export const SHELTER_PLUGIN_ROOT = "shelter/plugins";

const MANIFEST_FILE = "plugin.json";
const CODE_FILE = "plugin.js";

/** A file read, with the reason attached when it failed. */
type ReadResult =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

/** One staged plugin, or the reason it could not be read. */
export type StagedPlugin =
  | {
      readonly folder: string;
      readonly hostId: string;
      readonly ok: true;
      readonly manifestJson: string;
      readonly js: string;
    }
  | {
      readonly folder: string;
      readonly hostId: string;
      readonly ok: false;
      readonly reason: string;
    };

/**
 * The identity a plugin occupies: `shelter.<folder>`, matching the folder
 * the index publishes and the harness stages, so one id reads the same way
 * in the profile, the host, and the scoreboard.
 */
export function shelterPluginIdFor(folder: string): string {
  return `shelter.${folder}`;
}

async function readText(shell: ShellHost, path: string): Promise<ReadResult> {
  try {
    return { ok: true, text: await shell.files.readFile(path, "utf8") };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${path}: ${detail}` };
  }
}

/**
 * Lists and reads every staged plugin. An absent root (a fresh profile with
 * nothing installed) is an empty result; each directory is reported
 * separately so one broken install cannot hide the plugins next to it.
 */
export async function readStagedPlugins(shell: ShellHost | undefined): Promise<StagedPlugin[]> {
  if (!shell) return [];

  let folders: string[];
  try {
    folders = await shell.files.readdir(SHELTER_PLUGIN_ROOT);
  } catch {
    // Missing directory is the normal "nothing installed yet" case: an
    // unreadable one still shows up as zero plugins found, which the
    // harness reports against every acceptance entry as "did not register".
    return [];
  }

  const staged: StagedPlugin[] = [];
  for (const folder of folders.sort()) {
    if (folder.startsWith(".")) continue;
    const base = `${SHELTER_PLUGIN_ROOT}/${folder}`;
    const hostId = shelterPluginIdFor(folder);

    const manifest = await readText(shell, `${base}/${MANIFEST_FILE}`);
    if (!manifest.ok) {
      staged.push({ folder, hostId, ok: false, reason: `could not be read — ${manifest.reason}` });
      continue;
    }

    const code = await readText(shell, `${base}/${CODE_FILE}`);
    if (!code.ok) {
      staged.push({ folder, hostId, ok: false, reason: `could not be read — ${code.reason}` });
      continue;
    }

    staged.push({
      folder,
      hostId,
      ok: true,
      manifestJson: manifest.text,
      js: code.text,
    });
  }
  return staged;
}
