/**
 * `plugin.json` — Shelter's per-plugin manifest.
 *
 * A Shelter plugin is distributed as a pair: `plugin.json` describes it and
 * `plugin.js` is the code. Upstream validates nothing beyond the JSON
 * itself and keeps the whole object for the plugin to read through
 * `shelter.plugin.manifest`, which is reproduced here: every key passes
 * through verbatim, and only the one field Ion's host genuinely needs —
 * `name`, the display name — is required, because the host keys plugins by
 * a unique display name and a plugin without one cannot be listed, toggled,
 * or attributed on the scoreboard.
 *
 * Upstream keeps `Record<string, string | undefined>`; this type allows any
 * JSON value instead of rejecting a manifest that carries a number, which
 * upstream would happily store and hand back to the plugin.
 */

/** A parsed manifest: `name` plus everything else, verbatim. */
export type ShelterManifest = Readonly<Record<string, unknown>> & {
  /** Display name; also what the harness attributes messages to. */
  readonly name: string;
};

/** `plugin.json`'s origin, used to name the file in failure messages. */
function describe(origin: string): string {
  return `${origin}: plugin.json`;
}

/**
 * Parses a manifest. Throws a message naming the file and what is wrong —
 * the caller reports it as that plugin's load failure, never as a reason to
 * skip the plugin silently.
 */
export function parseManifest(source: string, origin: string): ShelterManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${describe(origin)} is not valid JSON: ${detail}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${describe(origin)} must contain a JSON object, got ${typeof parsed}`);
  }

  const manifest = parsed as Record<string, unknown>;
  const name = manifest["name"];
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error(`${describe(origin)} needs a non-empty "name" string`);
  }

  return Object.freeze({ ...manifest, name });
}
