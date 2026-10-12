/**
 * Ion's source-text patch engine.
 *
 * The patch shape and semantics deliberately mirror Vencord's and Equicord's
 * public patch format (their `Patch` interfaces are identical) so the compat
 * adapters can translate their patches one-to-one later:
 *
 * - `find` selects the module by its source (string containment or RegExp),
 * - `replacement`s transform the source sequentially,
 * - `group` makes a patch's replacements all-or-nothing,
 * - `all` lets one patch apply to several modules (otherwise it is consumed
 *   by the first module it patches),
 * - `predicate` decides at registration whether a patch exists at all,
 * - `fromBuild`/`toBuild` gate on Discord's build number when it is known.
 *
 * Semantics were studied from the upstream public sources; no code is copied
 * (see THIRD_PARTY.md). The engine is pure and cannot throw: failures come
 * back as `PatchNotice`s so the caller can name the plugin and patch in its
 * log and fall back to the original module.
 */

export interface PatchReplacement {
  /** The match for the replacement. A string is implicitly a RegExp. */
  readonly match: string | RegExp;
  /** The replacement string (String.replace semantics) or function. */
  readonly replace:
    string | ((...args: (string | number | Record<string, string> | undefined)[]) => string);
  /** Do not emit a notice when this replacement changes nothing. */
  readonly noWarn?: boolean;
  /** Skip this replacement when it is outside its build window. */
  readonly fromBuild?: number;
  readonly toBuild?: number;
}

export interface Patch {
  /** The plugin (or API) this patch belongs to; used in every notice. */
  readonly plugin: string;
  /** Identifies the module to patch: substring or RegExp over its source. */
  readonly find: string | RegExp;
  readonly replacement: PatchReplacement | readonly PatchReplacement[];
  /** Apply this patch to every module whose source matches, not just the first. */
  readonly all?: boolean;
  /** Do not emit a notice when a replacement changes nothing. */
  readonly noWarn?: boolean;
  /** All replacements must succeed, or the whole patch is rolled back. */
  readonly group?: boolean;
  /** Return false at registration to disable this patch entirely. */
  readonly predicate?: () => boolean;
  readonly fromBuild?: number;
  readonly toBuild?: number;
}

export interface PatchNotice {
  readonly plugin: string;
  readonly level: "warn" | "error";
  /** Fully formatted message (mentions the replacement and module id). */
  readonly message: string;
}

/**
 * Per-plugin patch telemetry, cumulative within the current registration
 * generation (disable/enable resets `registered`/`active`, keeps
 * `applied`/`notices` so a history of what already ran survives).
 */
export interface PluginPatchStats {
  /** Patches registered (predicate-dropped ones are not counted). */
  readonly registered: number;
  /** Module matches where a replacement changed the code. */
  readonly applied: number;
  /** Patches still waiting for a matching module. */
  readonly active: number;
  /** Engine notices attributed to the plugin (capped, oldest dropped). */
  readonly notices: readonly PatchNotice[];
}

/** Read-only view of the patch telemetry, exposed for the harness and UI. */
export interface PatchStatsApi {
  /** Keyed by the plugin name patches are attributed to. */
  stats(): Record<string, PluginPatchStats>;
}

/** Notices kept per plugin before the oldest are dropped. */
const MAX_NOTICES_PER_PLUGIN = 50;

export type RebuildResult =
  { readonly ok: true; readonly factory: unknown } | { readonly ok: false; readonly error: string };

/**
 * Turns patched source back into a function. The production rebuild uses
 * eval (see the webpack runtime); tests inject a cheap validation stub.
 * The engine calls it after every successful replacement so a syntactically
 * broken step is attributed to the exact replacement that broke it.
 */
export type Rebuild = (code: string) => RebuildResult;

export interface ApplyOptions {
  /** Module id, used for notice messages. */
  readonly moduleId?: string;
  /** Discord's build number; when unknown, build windows are not enforced. */
  readonly build?: number;
  readonly rebuild?: Rebuild;
}

export interface PatchOutcome {
  /** The patched source in expression form (`0,function(...)`), ready to eval. */
  readonly code: string;
  /** The rebuilt factory from the last successful rebuild, when one ran. */
  readonly factory?: unknown;
  /** Names of every plugin whose patch changed the code. */
  readonly patchedBy: readonly string[];
  readonly notices: readonly PatchNotice[];
}

interface CanonicalReplacement {
  readonly match: string | RegExp;
  readonly replace: PatchReplacement["replace"];
  // `| undefined` required by exactOptionalPropertyTypes when copying fields.
  readonly noWarn?: boolean | undefined;
  readonly fromBuild?: number | undefined;
  readonly toBuild?: number | undefined;
}

interface CanonicalPatch {
  readonly plugin: string;
  readonly find: string | RegExp;
  readonly replacements: readonly CanonicalReplacement[];
  readonly all?: boolean | undefined;
  readonly noWarn?: boolean | undefined;
  readonly group?: boolean | undefined;
  readonly fromBuild?: number | undefined;
  readonly toBuild?: number | undefined;
}

/**
 * Normalize factory source into an evaluable expression.
 * `(module, exports, require) => {}`  ->  `0,(module, exports, require) => {}`
 * `function (module, exports, require) {}` -> `0,function(module, exports, require) {}`
 */
export function toExpressionCode(source: string): string {
  const trimmed = source.trimStart();
  const firstParen = trimmed.indexOf("(");
  if (firstParen < 0) return `0,${trimmed}`;
  const body = trimmed.slice(firstParen);
  return trimmed.startsWith("(") ? `0,${body}` : `0,function${body}`;
}

/**
 * Canonicalize a match before it is used:
 * - RegExp: `\i` becomes an identifier matcher `(?:[A-Za-z_$][\w$]*)`
 *   (the same meaning Vencord/Equicord give it),
 * - strings pass through unchanged.
 *
 * `#{intl::...}` placeholders are not expanded here — that needs Discord's
 * message-hash runtime and is handled by the Vencord compat layer.
 */
export function canonicalizeMatch(match: string | RegExp): string | RegExp {
  if (typeof match === "string") return match;

  const source = match.source.replaceAll(/(\\*)\\i/g, (full: string, leading: string) =>
    leading.length % 2 === 0 ? `${leading}(?:[A-Za-z_$][\\w$]*)` : full.slice(1),
  );
  return new RegExp(source, match.flags);
}

function isReadonlyArray<T>(value: T | readonly T[]): value is readonly T[] {
  return Array.isArray(value);
}

function resetRegExp(regexp: RegExp): RegExp {
  if (regexp.global || regexp.sticky) regexp.lastIndex = 0;
  return regexp;
}

function matchesFind(source: string, find: string | RegExp): boolean {
  return typeof find === "string" ? source.includes(find) : resetRegExp(find).test(source);
}

function inBuildWindow(
  value: { readonly fromBuild?: number | undefined; readonly toBuild?: number | undefined },
  build: number | undefined,
): boolean {
  if (build === undefined) return true;
  if (value.fromBuild !== undefined && build < value.fromBuild) return false;
  if (value.toBuild !== undefined && build > value.toBuild) return false;
  return true;
}

function describeMatch(match: string | RegExp): string {
  return typeof match === "string" ? JSON.stringify(match) : String(match);
}

function canonicalizePatch(patch: Patch): CanonicalPatch {
  const replacements = isReadonlyArray(patch.replacement) ? patch.replacement : [patch.replacement];
  return {
    plugin: patch.plugin,
    find: canonicalizeMatch(patch.find),
    replacements: replacements.map((replacement) => ({
      match: canonicalizeMatch(replacement.match),
      replace: replacement.replace,
      noWarn: replacement.noWarn,
      fromBuild: replacement.fromBuild,
      toBuild: replacement.toBuild,
    })),
    all: patch.all,
    noWarn: patch.noWarn,
    group: patch.group,
    fromBuild: patch.fromBuild,
    toBuild: patch.toBuild,
  };
}

/**
 * Holds the active patch list. Patches whose predicate returns false are
 * dropped at registration; patches consumed by a module (those without
 * `all`) are removed as they apply — the same lifecycle as upstream.
 *
 * The registry also keeps counters and notices per plugin: the compat
 * harness verifies "patch applied / target reached / why not" from these,
 * which the log lines alone cannot answer.
 */
export class PatchRegistry {
  private readonly active: CanonicalPatch[];
  private readonly registered = new Map<string, number>();
  private readonly appliedCount = new Map<string, number>();
  private readonly noticesByPlugin = new Map<string, PatchNotice[]>();

  constructor(patches: Iterable<Patch> = []) {
    this.active = [];
    this.add(...patches);
  }

  /** Number of patches that have not yet been consumed. */
  get size(): number {
    return this.active.length;
  }

  /** Register additional patches (plugin loading happens before app scripts). */
  add(...patches: readonly Patch[]): void {
    for (const patch of patches) {
      // A throwing predicate is a plugin authoring error and propagates to
      // the plugin loader; a false predicate silently disables the patch.
      if (patch.predicate && !patch.predicate()) continue;
      this.active.push(canonicalizePatch(patch));
      this.registered.set(patch.plugin, (this.registered.get(patch.plugin) ?? 0) + 1);
    }
  }

  /**
   * Drop every active patch attributed to `plugin` (plugin disable/unload).
   * Modules the patch already modified keep the change — source patches are
   * one-way once a factory has evaluated; a plugin's `stop` owns runtime
   * reversion. Returns how many patches were removed.
   */
  removeByPlugin(plugin: string): number {
    let removed = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i]?.plugin === plugin) {
        this.active.splice(i, 1);
        removed += 1;
      }
    }
    // Every (re)registration starts a fresh generation for this plugin so a
    // disable/enable cycle does not inflate `registered`; `applied` and
    // `notices` stay cumulative on purpose. Called before each start, this
    // also clears the count of a plugin whose patches were all consumed.
    this.registered.delete(plugin);
    return removed;
  }

  /**
   * Cumulative per-plugin telemetry for the compat harness and debug UI:
   * patches registered (predicate-drops excluded), patches consumed by a
   * module, patches still waiting for their target, and every notice the
   * engine emitted for the plugin. Counters survive disable/enable cycles.
   */
  stats(): Record<string, PluginPatchStats> {
    const activeByPlugin = new Map<string, number>();
    for (const patch of this.active) {
      activeByPlugin.set(patch.plugin, (activeByPlugin.get(patch.plugin) ?? 0) + 1);
    }
    // Union of every plugin seen by the registry: a plugin that was just
    // disabled (registered reset) still reports its applied history.
    const plugins = new Set<string>([
      ...this.registered.keys(),
      ...this.appliedCount.keys(),
      ...this.noticesByPlugin.keys(),
      ...activeByPlugin.keys(),
    ]);
    const result: Record<string, PluginPatchStats> = {};
    for (const plugin of plugins) {
      result[plugin] = {
        registered: this.registered.get(plugin) ?? 0,
        applied: this.appliedCount.get(plugin) ?? 0,
        active: activeByPlugin.get(plugin) ?? 0,
        notices: this.noticesByPlugin.get(plugin) ?? [],
      };
    }
    return result;
  }

  /**
   * Apply every active patch that matches `source`.
   * Never throws: replace-function exceptions and rebuild failures become
   * notices; the returned `code` is always usable.
   */
  applyTo(source: string, options: ApplyOptions = {}): PatchOutcome {
    const { moduleId, build, rebuild } = options;
    const notices: PatchNotice[] = [];
    const moduleLabel = moduleId === undefined ? "" : ` (module id is ${moduleId})`;

    let code = toExpressionCode(source);
    let factory: unknown;
    let patchedBy = new Set<string>();

    for (let i = 0; i < this.active.length; i++) {
      const patch = this.active[i];
      if (!patch) continue;

      if (!inBuildWindow(patch, build)) {
        this.active.splice(i--, 1);
        continue;
      }

      if (!matchesFind(source, patch.find)) continue;

      // A patch is "applied" once a replacement changed the code and
      // survived (no group rollback) — counted once per module match.
      let fired = false;
      const codeBeforePatch = code;
      const factoryBeforePatch = factory;
      const patchedByBeforePatch = new Set(patchedBy);
      let rolledBack = false;

      for (const replacement of patch.replacements) {
        if (!inBuildWindow(replacement, build)) continue;

        const codeBeforeReplacement = code;
        const factoryBeforeReplacement = factory;

        try {
          const next =
            typeof replacement.replace === "string"
              ? code.replace(replacement.match, replacement.replace)
              : code.replace(replacement.match, replacement.replace);
          if (next === code) {
            if (!patch.noWarn && !replacement.noWarn) {
              notices.push({
                plugin: patch.plugin,
                level: "warn",
                message: `had no effect: ${describeMatch(replacement.match)}${moduleLabel}`,
              });
            }
            if (patch.group) {
              notices.push({
                plugin: patch.plugin,
                level: "warn",
                message: `undid group ${describeMatch(patch.find)} because ${describeMatch(replacement.match)} had no effect${moduleLabel}`,
              });
              rolledBack = true;
              break;
            }
            continue;
          }

          if (rebuild) {
            const result = rebuild(next);
            if (!result.ok) {
              notices.push({
                plugin: patch.plugin,
                level: "error",
                message: `replacement ${describeMatch(replacement.match)} produced invalid code: ${result.error}${moduleLabel}`,
              });
              code = codeBeforeReplacement;
              factory = factoryBeforeReplacement;
              if (patch.group) {
                notices.push({
                  plugin: patch.plugin,
                  level: "warn",
                  message: `undid group ${describeMatch(patch.find)} because ${describeMatch(replacement.match)} errored${moduleLabel}`,
                });
                rolledBack = true;
                break;
              }
              continue;
            }
            factory = result.factory;
          }

          code = next;
          patchedBy.add(patch.plugin);
          fired = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          notices.push({
            plugin: patch.plugin,
            level: "error",
            message: `replacement ${describeMatch(replacement.match)} threw: ${message}${moduleLabel}`,
          });
          code = codeBeforeReplacement;
          factory = factoryBeforeReplacement;
          if (patch.group) {
            notices.push({
              plugin: patch.plugin,
              level: "warn",
              message: `undid group ${describeMatch(patch.find)} because ${describeMatch(replacement.match)} errored${moduleLabel}`,
            });
            rolledBack = true;
            break;
          }
        }
      }

      if (rolledBack) {
        code = codeBeforePatch;
        factory = factoryBeforePatch;
        patchedBy = patchedByBeforePatch;
        fired = false;
      }

      if (fired) {
        this.appliedCount.set(patch.plugin, (this.appliedCount.get(patch.plugin) ?? 0) + 1);
      }

      if (!patch.all) this.active.splice(i--, 1);
    }

    // Notices from this pass, attributed per plugin (capped per plugin —
    // the harness reads them, the cap only bounds memory).
    for (const notice of notices) {
      const list = this.noticesByPlugin.get(notice.plugin);
      if (!list) this.noticesByPlugin.set(notice.plugin, [notice]);
      else {
        list.push(notice);
        if (list.length > MAX_NOTICES_PER_PLUGIN)
          list.splice(0, list.length - MAX_NOTICES_PER_PLUGIN);
      }
    }

    return { code, factory, patchedBy: [...patchedBy], notices };
  }
}
