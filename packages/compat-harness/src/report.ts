/**
 * Pure analysis: a smoke report + the acceptance list → per-plugin verdicts.
 *
 * No I/O and no Electron — the classifier is unit-tested, and the CLI only
 * feeds it files. Verdict semantics (see AGENTS.md's tier definitions):
 *
 * - Tier 1 (load): registered, start did not throw, no error-level patch
 *   notices. The smoke snapshot is taken at the end of the run, which
 *   subsumes load time — nothing retries a failed start, and patch notices
 *   are cumulative. A patch that failed late is conservatively counted here.
 * - Tier 2 (soak): additionally no uncaught renderer error attributable to
 *   the plugin through the end of the soak window. Only measured when the
 *   run's settle meets TIER2_MIN_SOAK_MS; otherwise "not-run" — a quick
 *   verification run never claims Tier 2.
 * - Tier 3 (owner) is always pending: the hand-check line travels with each
 *   plugin so the generated scoreboard doubles as the checklist.
 *
 * Console warnings/errors are attributed to plugins by anchored patterns
 * (bracketed prefix, host "plugin <name>" phrasing, translator "<name>: "
 * prefix). Anything unmatched stays visible as run notes instead of being
 * silently dropped or guessed at.
 */

/** One entry of an ecosystem's acceptance.json. */
export interface AcceptanceEntry {
  readonly group: "A" | "B" | "C" | "D" | "bulk";
  /** Vencord: the source folder under `vendor/vencord/src/plugins`. */
  readonly folder?: string;
  readonly name: string;
  /**
   * Host id when it differs from the plugin name. BetterDiscord plugins
   * register as `bd.<name>` and Shelter plugins as `shelter.<folder>`, so
   * their host state carries that id.
   */
  readonly id?: string;
  readonly note?: string;
  /**
   * One hand-written line explaining a measured failure, stored next to the
   * URL and hash it applies to so it cannot outlive the version it describes.
   * Rendered next to — never instead of — the measured reason, so the
   * scoreboard explains itself without losing the evidence.
   */
  readonly diagnosis?: string;
  readonly tier3?: string;
  /**
   * URL the harness downloads and stages (BetterDiscord: the raw plugin
   * file; Shelter: the directory holding `plugin.js` and `plugin.json`).
   */
  readonly url?: string;
  /** sha256 of what gets staged — for Shelter, `plugin.js`. */
  readonly sha256?: string;
  /** Shelter only: sha256 of `plugin.json`, pinned beside the executable. */
  readonly manifestSha256?: string;
  /**
   * Set when the runner deliberately did not stage this entry, carrying the
   * reason. Scoring such an entry as a failure would blame the adapter for a
   * file that never arrived; it is deferred, and the reason travels with it.
   */
  readonly unstaged?: string;
}

/** Which compatibility surface a report covers. */
export type Ecosystem = "vencord" | "bd" | "shelter";

export interface PatchNotice {
  readonly level: "warn" | "error";
  readonly message: string;
}

export interface PluginPatchStats {
  readonly registered: number;
  readonly applied: number;
  readonly active: number;
  readonly notices: readonly PatchNotice[];
}

/** The subset of shell-desktop's smoke report this classifier consumes. */
export interface SmokeReport {
  readonly session?: string;
  readonly settleMs?: number;
  readonly pluginsStatus?: {
    readonly status?: {
      readonly registered?: number;
      readonly started?: number;
      readonly failed?: number;
    };
    readonly ids?: readonly string[];
    readonly failures?: readonly { readonly id: string; readonly error: string }[];
    /**
     * Host id → the name the plugin actually registered under.
     *
     * An adapter may suffix a name to satisfy the host's uniqueness rule
     * (two published plugins sharing one, or one colliding with another
     * adapter's), and the console label follows the *registered* name. This
     * is the host's own answer, so no collision rule has to be duplicated
     * between an adapter and this file.
     */
    readonly names?: Record<string, string>;
  } | null;
  readonly rendererErrors?: readonly string[];
  readonly expectedErrors?: Record<string, number>;
  readonly warnings?: readonly string[];
  readonly patchStats?: Record<string, PluginPatchStats> | null;
}

/** Soak window required before Tier 2 may be claimed. */
export const TIER2_MIN_SOAK_MS = 120_000;

export type TierVerdict = "pass" | "fail" | "not-run";
export type PluginStatus = "pass" | "warnings" | "fail" | "deferred";

/** How the plugin fared at load, in the harness's outcome vocabulary. */
export type LoadOutcome = "loaded" | "loaded-with-warnings" | "failed" | "not-registered";

export interface CompatPluginReport {
  readonly name: string;
  readonly group: string;
  readonly outcome: LoadOutcome;
  readonly tier1: TierVerdict;
  readonly tier2: TierVerdict;
  readonly status: PluginStatus;
  /** One line; non-null for every non-pass status and every warning. */
  readonly reason: string | null;
  /** Hand-written explanation from the acceptance set, when one exists. */
  readonly diagnosis: string | null;
  /** Host lifecycle state, or null when the plugin never registered. */
  readonly state: string | null;
  readonly startError: string | null;
  readonly patches: {
    readonly registered: number;
    readonly applied: number;
    readonly active: number;
    readonly errorNotices: readonly string[];
    readonly warnNotices: readonly string[];
  };
  readonly warnings: readonly string[];
  readonly handCheck: string;
}

export interface CompatReport {
  readonly generatedAt: string;
  readonly meta: {
    readonly ecosystem: Ecosystem;
    readonly upstream: string;
    readonly session: string;
    readonly soakMs: number;
    readonly tier2Run: boolean;
  };
  readonly summary: {
    readonly total: number;
    readonly pass: number;
    readonly warnings: number;
    readonly fail: number;
    readonly deferred: number;
  };
  readonly run: {
    readonly registered: number;
    readonly started: number;
    readonly failed: number;
    readonly rendererErrors: readonly string[];
    readonly unattributedRendererErrors: readonly string[];
    readonly expectedErrors: readonly { readonly reason: string; readonly count: number }[];
    readonly unattributedWarnings: readonly string[];
    readonly patchTotals: {
      readonly registered: number;
      readonly applied: number;
      readonly active: number;
    };
  };
  readonly plugins: readonly CompatPluginReport[];
  /**
   * True only when everything the run produced was attributable.
   *
   * An error placed on a plugin is a *result* — it fails that plugin's row
   * and the process exits non-zero for it — so it does not make the run
   * itself unsound. An error that could not be placed does: it is the
   * measurement saying it does not know what it was looking at. Every
   * renderer error stays in `run.rendererErrors` either way.
   */
  readonly runHealthy: boolean;
}

export interface AnalyzeOptions {
  readonly generatedAt: string;
  readonly ecosystem: Ecosystem;
  readonly upstream: string;
}

const MAX_REASON_LENGTH = 160;

/** Collapse a message into one report-sized line. */
function oneLine(message: string): string {
  const collapsed = message.replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_REASON_LENGTH
    ? collapsed
    : `${collapsed.slice(0, MAX_REASON_LENGTH - 1)}…`;
}

/**
 * The origin Shelter evaluates a plugin's code under, when the entry names
 * one.
 *
 * Every plugin file is evaluated with a `sourceURL` that names its folder,
 * and the smoke capture appends a message's source to it — so for these
 * entries the file is available as evidence, not just the label the plugin
 * wrote for itself.
 */
function shelterOrigin(id: string | undefined): string | undefined {
  return id?.startsWith("shelter.") === true
    ? `s://!SHELTER/${id.slice("shelter.".length)}`
    : undefined;
}

/** Patterns that identify a message as belonging to `name`. */
function isAttributedTo(message: string, name: string, origin?: string): boolean {
  // BdApi's logger prints `%c[Name]%c` with console style arguments; if the
  // format specifiers survive into the captured text, drop them before
  // matching (a no-op for already-formatted messages).
  const text = message.replaceAll("%c", "");
  return (
    text.startsWith(`[${name}]`) ||
    text.startsWith(`${name}:`) ||
    new RegExp(`\\bplugin ${name}\\b`).test(text) ||
    // …or the message says where it came from. Stronger than any phrasing:
    // an error raised under a plugin's own `sourceURL` could not have been
    // produced anywhere else, and a Content Security Policy refusal often
    // carries nothing but this. Matched as the whole bracketed marker, not a
    // bare substring: `s://!SHELTER/a` is a prefix of `s://!SHELTER/a-2`.
    (origin !== undefined && text.includes(`[source: ${origin}]`))
  );
}

/** Split messages into those attributed to `name` and the rest. */
function partitionAttributed(
  messages: readonly string[],
  name: string,
  origin?: string,
): [attributed: string[], rest: string[]] {
  const attributed: string[] = [];
  const rest: string[] = [];
  for (const message of messages) {
    (isAttributedTo(message, name, origin) ? attributed : rest).push(message);
  }
  return [attributed, rest];
}

const EMPTY_PATCHES: PluginPatchStats = { registered: 0, applied: 0, active: 0, notices: [] };

/** Classify every acceptance plugin against one smoke run. */
export function analyze(
  smoke: SmokeReport,
  acceptance: readonly AcceptanceEntry[],
  options: AnalyzeOptions,
): CompatReport {
  const soakMs = smoke.settleMs ?? 0;
  const tier2Run = soakMs >= TIER2_MIN_SOAK_MS;
  const ids = smoke.pluginsStatus?.ids ?? [];
  const states = new Map<string, string>();
  for (const entry of ids) {
    const separator = entry.lastIndexOf(":");
    if (separator > 0) states.set(entry.slice(0, separator), entry.slice(separator + 1));
  }
  const startErrors = new Map(
    (smoke.pluginsStatus?.failures ?? []).map((failure) => [failure.id, failure.error]),
  );
  const rendererErrors = smoke.rendererErrors ?? [];
  const warnings = smoke.warnings ?? [];
  const patchStats = smoke.patchStats ?? {};
  const registeredNames = smoke.pluginsStatus?.names ?? {};

  // What the host registered an entry under, when it registered at all.
  // Prefer it over the catalog's own name: the adapter is the thing that
  // decided, and its answer is what the plugin's console label carries.
  const displayNameOf = (entry: AcceptanceEntry): string =>
    registeredNames[entry.id ?? entry.name] ?? entry.name;

  // Renderer errors are attributed once for the whole run; leftovers become
  // run-level failures (never silently dropped).
  const unattributedRendererErrors: string[] = [];
  const perPluginRendererErrors = new Map<string, string[]>();
  {
    let rest = [...rendererErrors];
    for (const entry of acceptance) {
      const name = displayNameOf(entry);
      const [mine, leftover] = partitionAttributed(rest, name, shelterOrigin(entry.id));
      if (mine.length > 0) perPluginRendererErrors.set(name, mine);
      rest = leftover;
    }
    unattributedRendererErrors.push(...rest);
  }

  let unattributedWarnings = [...warnings];
  const plugins: CompatPluginReport[] = [];

  for (const entry of acceptance) {
    // The host keys plugin state by its id; for BetterDiscord plugins that
    // is `bd.<name>` (recorded as `id` in the acceptance entry).
    const hostId = entry.id ?? entry.name;
    const name = displayNameOf(entry);
    const origin = shelterOrigin(entry.id);
    const [pluginWarnings, leftover] = partitionAttributed(unattributedWarnings, name, origin);
    unattributedWarnings = leftover;

    const registered = states.has(hostId);
    const state = states.get(hostId) ?? null;
    const startError = startErrors.get(hostId) ?? null;
    const stats = patchStats[hostId] ?? EMPTY_PATCHES;
    const errorNotices = stats.notices
      .filter((notice) => notice.level === "error")
      .map((notice) => oneLine(notice.message));
    const warnNotices = stats.notices
      .filter((notice) => notice.level === "warn")
      .map((notice) => oneLine(notice.message));
    const pluginRendererErrors = perPluginRendererErrors.get(name) ?? [];

    // Tier 1 — load.
    let tier1: TierVerdict = "pass";
    let tier1Reason: string | null = null;
    let tier2: TierVerdict = "not-run";
    let tier2Reason: string | null = null;

    if (entry.unstaged !== undefined) {
      // Never staged, so nothing about it was measured. Scoring it as a
      // failure would blame the adapter for a file that never arrived.
      tier1 = "not-run";
      tier1Reason = entry.unstaged;
    } else {
      if (!registered) {
        tier1 = "fail";
        tier1Reason = "did not register — translation failed (see the run's renderer errors)";
      } else if (state === "failed" || startError !== null) {
        tier1 = "fail";
        tier1Reason = `start failed: ${oneLine(startError ?? "unknown error")}`;
      } else if (errorNotices.length > 0) {
        tier1 = "fail";
        tier1Reason = `patch failed: ${errorNotices[0] ?? "unknown notice"}`;
      }

      // Tier 2 — soak. A measured failure is always claimable; a pass is only
      // claimed when the run actually soaked long enough.
      if (tier1 === "fail") {
        tier2 = "fail";
        tier2Reason = tier1Reason;
      } else if (pluginRendererErrors.length > 0) {
        tier2 = "fail";
        const [firstError = "unknown error"] = pluginRendererErrors;
        tier2Reason = `uncaught error: ${oneLine(firstError)}`;
      } else if (tier2Run) {
        tier2 = "pass";
      }
    }

    const deferred = entry.note?.includes("deferred") ?? false;
    const outcome: LoadOutcome =
      !registered || entry.unstaged !== undefined
        ? "not-registered"
        : tier1 === "fail"
          ? "failed"
          : pluginWarnings.length + warnNotices.length > 0
            ? "loaded-with-warnings"
            : "loaded";

    let status: PluginStatus;
    let reason: string | null;
    if (entry.unstaged !== undefined) {
      status = "deferred";
      reason = oneLine(entry.unstaged);
    } else if (tier1 === "fail" || tier2 === "fail") {
      status = "fail";
      reason = oneLine((tier1 === "fail" ? tier1Reason : tier2Reason) ?? "failed");
    } else if (deferred) {
      status = "deferred";
      reason = oneLine(entry.note ?? "deferred");
    } else if (outcome === "loaded-with-warnings") {
      status = "warnings";
      const first = [...pluginWarnings, ...warnNotices][0] ?? "unknown warning";
      reason = oneLine(first);
    } else {
      status = "pass";
      reason = null;
    }

    plugins.push({
      // The host's registered name, so a row reads exactly as the plugin's
      // own console lines do.
      name,
      group: entry.group,
      outcome,
      tier1,
      tier2,
      status,
      reason,
      diagnosis: entry.diagnosis ?? null,
      state,
      startError,
      patches: {
        registered: stats.registered,
        applied: stats.applied,
        active: stats.active,
        errorNotices,
        warnNotices,
      },
      warnings: [...pluginWarnings, ...warnNotices].map(oneLine),
      handCheck: entry.tier3 ?? "—",
    });
  }

  const summary = {
    total: plugins.length,
    pass: plugins.filter((plugin) => plugin.status === "pass").length,
    warnings: plugins.filter((plugin) => plugin.status === "warnings").length,
    fail: plugins.filter((plugin) => plugin.status === "fail").length,
    deferred: plugins.filter((plugin) => plugin.status === "deferred").length,
  };

  const patchTotals = { registered: 0, applied: 0, active: 0 };
  for (const stats of Object.values(patchStats)) {
    patchTotals.registered += stats.registered;
    patchTotals.applied += stats.applied;
    patchTotals.active += stats.active;
  }

  return {
    generatedAt: options.generatedAt,
    meta: {
      ecosystem: options.ecosystem,
      upstream: options.upstream,
      session: smoke.session ?? "unknown",
      soakMs,
      tier2Run,
    },
    summary,
    run: {
      registered: smoke.pluginsStatus?.status?.registered ?? 0,
      started: smoke.pluginsStatus?.status?.started ?? 0,
      failed: smoke.pluginsStatus?.status?.failed ?? 0,
      rendererErrors: rendererErrors.map(oneLine),
      unattributedRendererErrors: unattributedRendererErrors.map(oneLine),
      expectedErrors: Object.entries(smoke.expectedErrors ?? {}).map(([reason, count]) => ({
        reason,
        count,
      })),
      unattributedWarnings: unattributedWarnings.map(oneLine),
      patchTotals,
    },
    plugins,
    runHealthy: unattributedRendererErrors.length === 0,
  };
}
