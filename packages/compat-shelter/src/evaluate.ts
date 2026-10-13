/**
 * Page-side evaluation of Shelter plugin code.
 *
 * Upstream wraps each plugin's source in an arrow function whose single
 * parameter is named `shelter`, so the plugin's free reference to
 * `shelter` — how every Lune-built plugin reaches the API — resolves to the
 * per-plugin edition (the window API plus `shelter.plugin`) rather than to
 * the global. The construction below is upstream's byte for byte, including
 * the `sourceURL` label that makes stack traces name the plugin:
 *
 *     shelter=>{return <plugin.js>}
 *     //# sourceURL=s://!SHELTER/<folder>
 *
 * (uwu/shelter is CC0-1.0; see THIRD_PARTY.md.)
 *
 * Indirect eval runs the wrapper in the page's global scope, which is
 * exactly the capability a client-mod plugin is written against: it shares
 * globals with Discord. Nothing here grants file, network, or process
 * access beyond the page.
 */

/** What a Shelter plugin file may evaluate to. */
export interface ShelterPluginExport {
  readonly onLoad?: (() => void) | undefined;
  readonly onUnload?: (() => void) | undefined;
  /** A Solid component shelter's settings UI renders. */
  readonly settings?: ((props: Record<string, unknown>) => unknown) | undefined;
}

/** What one plugin file produced, plus anything odd about it. */
export interface ShelterPluginEvaluation {
  /**
   * The plugin object — empty when the file evaluated to nothing, which
   * shelter's own loader tolerates: it spreads the result (`{ ...undefined }`
   * is `{}`) and calls `onLoad?.()`, so a plugin written to do all of its
   * work while being evaluated installs its patches and interceptors in the
   * module body and has no hooks to call afterwards.
   */
  readonly plugin: ShelterPluginExport;
  /**
   * A one-line observation to report under the plugin, or null when there is
   * nothing to say. Set rather than thrown for the case above: such a plugin
   * loads exactly as it does upstream, so failing it would blame it for our
   * strictness — but "started with no lifecycle hooks" belongs on the record
   * rather than being hidden by a silent `{}`.
   */
  readonly note: string | null;
}

/** Names a value for a failure message without printing its contents. */
function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/**
 * Evaluates `js` and returns the plugin object it produced.
 *
 * Throws a message naming the plugin and what is wrong — a malformed file
 * fails that one plugin with a reason, never the batch.
 */
export function evaluateShelterPlugin(
  js: string,
  folder: string,
  api: unknown,
): ShelterPluginEvaluation {
  const source = `shelter=>{return ${js}}\n//# sourceURL=s://!SHELTER/${folder}`;
  const wrapper = (0, eval)(source) as (shelter: unknown) => unknown;

  if (typeof wrapper !== "function") {
    throw new Error(`plugin.js did not evaluate to a function (${typeof wrapper})`);
  }

  const produced = wrapper(api);

  if (produced === undefined || produced === null) {
    return {
      plugin: {},
      note:
        `plugin.js evaluated to ${describeValue(produced)} — no lifecycle hooks, ` +
        `so everything it does happened while it was being evaluated`,
    };
  }

  if (typeof produced !== "object" || Array.isArray(produced)) {
    throw new Error(
      `plugin.js evaluated to ${describeValue(produced)}, expected an object with onLoad/onUnload`,
    );
  }

  const plugin = produced as Record<string, unknown>;
  for (const lifecycle of ["onLoad", "onUnload"] as const) {
    const hook = plugin[lifecycle];
    if (hook !== undefined && typeof hook !== "function") {
      throw new Error(`${lifecycle} must be a function, got ${typeof hook}`);
    }
  }

  return { plugin, note: null };
}
