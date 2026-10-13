/**
 * compat-harness CLI — runs a seeded smoke of an ecosystem's acceptance set
 * and turns its report into per-plugin verdicts plus the generated
 * scoreboard (docs/compat.md, docs/compat-bd.md, or docs/compat-shelter.md).
 *
 * The electron launch itself stays in scripts/smoke.mjs (one place owns
 * nice/ionice, isolated profiles, and the report contract); this runner only
 * adds the seed (all acceptance plugins enabled), chooses the soak window,
 * and classifies the outcome.
 *
 * Ecosystems:
 * - vencord (default): seeds every acceptance plugin on in Vencord's
 *   settings (upstream only registers patches for enabled plugins).
 * - bd: BetterDiscord plugins are plain files, so the runner downloads each
 *   acceptance entry from its sha256-pinned raw URL, verifies the hash, and
 *   stages the files into `<profile>/ion/bd/plugins` before launch. The
 *   profile is a throwaway temp dir owned (and cleaned up) by this runner,
 *   unless `--profile` names one explicitly.
 * - shelter: each entry is a plugin *directory* on the author's own site —
 *   the adapter reads `<profile>/ion/shelter/plugins/<folder>/plugin.js` and
 *   `plugin.json`, so the runner fetches both with `new URL(..., base)` the
 *   way shelter's updater does and verifies each against its own pinned
 *   digest before writing it. Nothing staged is unverified.
 *
 * Sources:
 * - acceptance (default): the checked-in, hash-pinned set — the number the
 *   project commits to, and the only one where a file moving upstream is
 *   caught rather than measured.
 * - index: the ecosystem's live catalog (shelter only, for now). Every
 *   plugin it lists is staged and scored as one sweep. Nothing is pinned
 *   because the catalog publishes no digests; instead the digest of every
 *   file actually staged is written to the run's artifacts, so a sweep can
 *   be reproduced or re-compared. A plugin whose code cannot be fetched is
 *   deferred with the reason — nothing was measured, and calling it a
 *   failure would blame the adapter for a file that never arrived.
 *
 * Usage:
 *   node dist/index.js [--ecosystem vencord|bd|shelter] [--out <dir>]
 *                      [--settle-ms <n>] [--profile <dir>] [--docs <path>]
 *                      [--report <smoke-report.json>]
 *
 * Exit code 0 only for a healthy run with no failed plugins: warnings and
 * documented deferrals are recorded, never hidden.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderCompatMarkdown } from "./markdown";
import { analyze, type AcceptanceEntry, type Ecosystem, type SmokeReport } from "./report";
import { SHELTER_INDEX_DIAGNOSES } from "./shelter-diagnoses";

const DEFAULT_SETTLE_MS = 180_000;
/** Slack on top of the soak before the smoke's own timeout fires. */
const SMOKE_MARGIN_MS = 120_000;

interface CliOptions {
  readonly ecosystem: Ecosystem;
  /** How the plugin set is chosen: the checked-in acceptance file, or the live index. */
  readonly source: PluginSource;
  readonly out: string | null;
  readonly settleMs: number;
  readonly profile: string | null;
  readonly docs: string | null;
  readonly reportOnly: string | null;
}

const USAGE = `compat-harness — score an ecosystem's acceptance set

  --ecosystem NAME   vencord (default), bd, or shelter
  --source NAME      acceptance (default): the checked-in, hash-pinned set.
                     index: the ecosystem's live catalog — every plugin it
                     lists (shelter only for now), scored as one sweep
  --out DIR          run artifacts (default: compat-runs/<timestamp>)
  --settle-ms N      soak window before the report (default: ${String(DEFAULT_SETTLE_MS)})
  --profile DIR      isolated profile (default: a throwaway temp profile)
  --docs PATH        generated scoreboard (default: docs/compat.md, or
                     docs/compat-bd.md / docs/compat-shelter.md per ecosystem)
  --report PATH      analyze an existing smoke report.json; do not run
  --help             this text
`;

/** Every ecosystem this runner knows how to seed. */
const ECOSYSTEMS = ["vencord", "bd", "shelter"] as const;

/** How the plugin set to score is chosen. */
const SOURCES = ["acceptance", "index"] as const;
type PluginSource = (typeof SOURCES)[number];

/** Generated scoreboard path when `--docs` is absent. */
const DOCS_PATHS: Readonly<Record<Ecosystem, string>> = {
  vencord: "compat.md",
  bd: "compat-bd.md",
  shelter: "compat-shelter.md",
};

/** Scoreboard path for an index sweep, which is a different document. */
const INDEX_DOCS_PATHS: Readonly<Record<Ecosystem, string>> = {
  vencord: "compat-vencord-index.md",
  bd: "compat-bd-index.md",
  shelter: "compat-shelter-index.md",
};

/** Which workspace package owns each ecosystem's acceptance file. */
const ACCEPTANCE_PACKAGES: Readonly<Record<Ecosystem, string>> = {
  vencord: "compat-vencord",
  bd: "compat-bd",
  shelter: "compat-shelter",
};

function isEcosystem(value: string): value is Ecosystem {
  return (ECOSYSTEMS as readonly string[]).includes(value);
}

function isSource(value: string): value is PluginSource {
  return (SOURCES as readonly string[]).includes(value);
}

/** Value of `--flag VALUE` or `--flag=VALUE`, or null when absent. */
function valueOf(argv: readonly string[], flag: string): string | null {
  const eq = argv.find((entry) => entry.startsWith(`${flag}=`));
  if (eq !== undefined) {
    const value = eq.slice(flag.length + 1);
    return value.length > 0 ? value : null;
  }
  const index = argv.indexOf(flag);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1] ?? null;
  return null;
}

const VALUE_FLAGS = [
  "--ecosystem",
  "--source",
  "--out",
  "--settle-ms",
  "--profile",
  "--docs",
  "--report",
];

function parseArgs(argv: readonly string[]): CliOptions | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (flag === "--help" || flag === "-h") continue;
    if (!VALUE_FLAGS.includes(flag)) throw new Error(`unknown argument: ${arg}`);
    if (!arg.includes("=")) {
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      i += 1; // consume the space-separated value
    }
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return null;
  }

  const ecosystemRaw = valueOf(argv, "--ecosystem") ?? "vencord";
  if (!isEcosystem(ecosystemRaw)) {
    throw new Error(`unknown --ecosystem: ${ecosystemRaw} (expected ${ECOSYSTEMS.join(", ")})`);
  }
  const ecosystem: Ecosystem = ecosystemRaw;

  const sourceRaw = valueOf(argv, "--source") ?? "acceptance";
  if (!isSource(sourceRaw)) {
    throw new Error(`unknown --source: ${sourceRaw} (expected ${SOURCES.join(", ")})`);
  }
  if (sourceRaw === "index" && ecosystem !== "shelter") {
    throw new Error(
      `--source index is not available for --ecosystem ${ecosystem} yet ` +
        `(the harness can only sweep a catalog it knows how to fetch)`,
    );
  }
  const source: PluginSource = sourceRaw;

  const settleRaw = valueOf(argv, "--settle-ms");
  let settleMs = DEFAULT_SETTLE_MS;
  if (settleRaw !== null) {
    const parsed = Number(settleRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`invalid --settle-ms: ${settleRaw}`);
    }
    settleMs = parsed;
  }
  return {
    ecosystem,
    source,
    out: valueOf(argv, "--out"),
    settleMs,
    profile: valueOf(argv, "--profile"),
    docs: valueOf(argv, "--docs"),
    reportOnly: valueOf(argv, "--report"),
  };
}

/** Repository root: this file lives at packages/compat-harness/dist/. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** An isolated profile the runner launched against. */
interface RunProfile {
  readonly dir: string;
  /** True when this runner created the profile and must delete it after. */
  readonly owned: boolean;
}

/** A browser user agent: some hosts 403 the runtime's default one. */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** The live Shelter plugin index: a list of author repos and their plugins. */
const SHELTER_INDEX_URL = "https://shindex.uwu.network/data";

/**
 * Fetches `url` and checks it against `expected`. A non-2xx response or a
 * digest mismatch throws, so an unverifiable plugin never reaches the client.
 */
async function fetchVerified(url: string, expected: string, what: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`download failed for ${what}: HTTP ${String(response.status)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expected) {
    throw new Error(`sha256 mismatch for ${what}: pinned ${expected}, downloaded ${digest}`);
  }
  return bytes;
}

/** Writes `contents` into `path`, creating the directory first. */
async function stageFile(path: string, contents: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

/** A download that produced bytes, or explains why it did not. */
type FetchOutcome =
  { readonly ok: true; readonly bytes: Buffer } | { readonly ok: false; readonly reason: string };

/**
 * Fetches `url` with no pin to check against.
 *
 * Used by the index sweep, where the catalog publishes no digests. It
 * reports rather than throws because one dead plugin must not stop the other
 * hundred from being measured.
 */
async function fetchBytes(url: string): Promise<FetchOutcome> {
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) return { ok: false, reason: `HTTP ${String(response.status)}` };
    return { ok: true, bytes: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    return { ok: false, reason: `download failed: ${message(error)}` };
  }
}

/** One line from any thrown value. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A non-empty string field from an untyped JSON document, or undefined. */
function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The `name` a Shelter manifest publishes, or undefined when it publishes
 * none — the same test `ShelterPluginManager` applies before letting a
 * manifest name a plugin.
 */
function manifestNameOf(bytes: Buffer): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  return stringField((parsed as Record<string, unknown>)["name"]);
}

/**
 * Renames swept entries the way the adapter renames the plugins behind them
 * when two publish under one name.
 *
 * The adapter appends the folder to *every* member of a contested group so
 * the host's uniqueness rule holds. The harness has to reach the same answer
 * from its side: a row is keyed by its id, but a console message is
 * attributed by name, and a name only one side knows would push the second
 * plugin's own warnings into the run's unattributed bucket — visible, but
 * credited to nothing.
 *
 * Entries that were never staged are left alone: they are not registered, so
 * they claim no name.
 */
function resolveSweepNames(entries: readonly AcceptanceEntry[]): AcceptanceEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.unstaged !== undefined) continue;
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }

  const prefix = "shelter.";
  return entries.map((entry) => {
    if (entry.unstaged !== undefined || (counts.get(entry.name) ?? 0) < 2) return entry;
    const id = entry.id ?? "";
    if (!id.startsWith(prefix)) return entry;
    return { ...entry, name: `${entry.name} (${id.slice(prefix.length)})` };
  });
}

/** Provenance for one staged file: where it came from and how it verified. */
interface StagedFile {
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
  readonly file: string;
  /** Index sweep only: the author repo the plugin was listed under. */
  readonly repo?: string;
}

/** Writes the provenance record beside the run's other artifacts. */
async function writeStaged(artifactsDir: string, file: string, staged: unknown): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(resolve(artifactsDir, file), `${JSON.stringify(staged, null, 2)}\n`);
}

/**
 * Downloads and hash-verifies every acceptance entry, staging the files
 * into `<profile>/ion/bd/plugins`.
 */
async function stageBdPlugins(
  profileDir: string,
  acceptance: readonly AcceptanceEntry[],
  artifactsDir: string,
): Promise<void> {
  const pluginsDir = resolve(profileDir, "ion", "bd", "plugins");
  const staged: StagedFile[] = [];

  for (const entry of acceptance) {
    if (entry.url === undefined || entry.sha256 === undefined) {
      throw new Error(`acceptance entry ${entry.name} needs url + sha256 for --ecosystem bd`);
    }
    const bytes = await fetchVerified(entry.url, entry.sha256, entry.name);
    const file = basename(new URL(entry.url).pathname);
    await stageFile(resolve(pluginsDir, file), bytes);
    staged.push({ name: entry.name, url: entry.url, sha256: entry.sha256, file });
  }

  // Provenance travels with the run artifacts: every staged file, its
  // pinned source, and the verified digest.
  await writeStaged(artifactsDir, "bd-staged.json", staged);
}

/**
 * Downloads and hash-verifies every acceptance entry, staging each plugin as
 * `<profile>/ion/shelter/plugins/<folder>/{plugin.js,plugin.json}` — the
 * layout the Shelter adapter's staging reader expects. Both files are pinned:
 * the executable *and* the manifest that names it.
 */
async function stageShelterPlugins(
  profileDir: string,
  acceptance: readonly AcceptanceEntry[],
  artifactsDir: string,
): Promise<void> {
  const pluginsRoot = resolve(profileDir, "ion", "shelter", "plugins");
  const staged: StagedFile[] = [];

  for (const entry of acceptance) {
    if (entry.url === undefined || entry.sha256 === undefined || entry.id === undefined) {
      throw new Error(
        `acceptance entry ${entry.name} needs id + url + sha256 for --ecosystem shelter`,
      );
    }
    if (entry.manifestSha256 === undefined) {
      throw new Error(
        `acceptance entry ${entry.name} needs manifestSha256 for --ecosystem shelter`,
      );
    }
    if (!entry.id.startsWith("shelter.")) {
      throw new Error(
        `acceptance entry ${entry.name} has id ${entry.id}, which is not a shelter.* host id`,
      );
    }
    const folder = entry.id.slice("shelter.".length);
    const dir = resolve(pluginsRoot, folder);
    // The folder name comes from a checked-in file, but it still has to land
    // directly under the plugins root — no separators, no traversal.
    if (dirname(dir) !== pluginsRoot) {
      throw new Error(`acceptance entry ${entry.name} has an unusable folder name: ${folder}`);
    }

    // Both parts of the plugin, resolved exactly as shelter's own updater
    // resolves them, each verified against its own pin.
    const jsUrl = new URL("plugin.js", entry.url).href;
    const manifestUrl = new URL("plugin.json", entry.url).href;
    const js = await fetchVerified(jsUrl, entry.sha256, `${entry.name} plugin.js`);
    const manifest = await fetchVerified(
      manifestUrl,
      entry.manifestSha256,
      `${entry.name} plugin.json`,
    );
    await stageFile(resolve(dir, "plugin.js"), js);
    await stageFile(resolve(dir, "plugin.json"), manifest);
    staged.push({
      name: entry.name,
      url: jsUrl,
      sha256: entry.sha256,
      file: `${folder}/plugin.js`,
    });
    staged.push({
      name: entry.name,
      url: manifestUrl,
      sha256: entry.manifestSha256,
      file: `${folder}/plugin.json`,
    });
  }

  await writeStaged(artifactsDir, "shelter-staged.json", staged);
}

/**
 * Stages every plugin the live Shelter index lists and returns one entry per
 * plugin to score.
 *
 * Nothing is pinned here: the index publishes no digests, so there is no
 * value to verify against. What was actually staged is recorded instead,
 * which is what makes a sweep reproducible — a later pass can re-download
 * and compare against the run it is being read alongside, rather than
 * against a pin that never existed.
 *
 * A plugin whose `plugin.js` cannot be fetched is deferred with the reason
 * rather than failed: nothing was measured, and calling it a failure would
 * blame the adapter. A plugin whose `plugin.json` cannot be fetched *is*
 * staged — the adapter reads the directory as it finds it and reports a
 * plugin it cannot name, which is the measured truth about what the author
 * published.
 */
async function stageShelterIndex(
  profileDir: string,
  artifactsDir: string,
): Promise<AcceptanceEntry[]> {
  const response = await fetch(SHELTER_INDEX_URL, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`the Shelter index did not answer: HTTP ${String(response.status)}`);
  }
  const repos: unknown = await response.json();
  if (!Array.isArray(repos)) {
    throw new Error("the Shelter index did not answer with a list of repositories");
  }

  const pluginsRoot = resolve(profileDir, "ion", "shelter", "plugins");
  const taken = new Map<string, number>();
  const staged: StagedFile[] = [];
  const entries: AcceptanceEntry[] = [];

  for (const rawRepo of repos) {
    const repo = rawRepo as { name?: unknown; plugins?: unknown };
    const repoName = stringField(repo.name) ?? "";
    if (!Array.isArray(repo.plugins)) continue;

    for (const rawPlugin of repo.plugins) {
      const plugin = rawPlugin as { name?: unknown; author?: unknown; url?: unknown };
      const url = stringField(plugin.url);
      // The index lists what the author published; a plugin with no source
      // URL has nothing to install and nothing to measure.
      if (url === undefined) continue;
      const name = stringField(plugin.name) ?? url;

      let folder: string;
      let jsUrl: string;
      let manifestUrl: string;
      try {
        // The index lists plugin directories without a trailing slash, and a
        // relative resolution against one drops the last segment:
        // `.../blur-nsfw` + `plugin.js` is `.../plugin.js`. Normalize the
        // base to a directory first — which is what shelter's own index
        // entries already look like.
        const base = url.endsWith("/") ? url : `${url}/`;
        const segments = new URL(base).pathname.split("/").filter((part) => part.length > 0);
        const slug = segments.at(-1) ?? "plugin";
        // Three plugins in the index share a slug with another. The index's
        // own order decides, so the same sweep always numbers them the same
        // way.
        const seen = taken.get(slug) ?? 0;
        taken.set(slug, seen + 1);
        folder = seen === 0 ? slug : `${slug}-${String(seen + 1)}`;
        jsUrl = new URL("plugin.js", base).href;
        manifestUrl = new URL("plugin.json", base).href;
      } catch (error) {
        entries.push({
          group: "bulk",
          name,
          unstaged: `not staged: the index lists an unusable URL (${message(error)})`,
        });
        continue;
      }

      const js = await fetchBytes(jsUrl);
      if (!js.ok) {
        entries.push({
          group: "bulk",
          name,
          id: `shelter.${folder}`,
          url,
          unstaged: `not staged: plugin.js ${js.reason}`,
        });
        continue;
      }

      await stageFile(resolve(pluginsRoot, folder, "plugin.js"), js.bytes);
      staged.push({
        name,
        url: jsUrl,
        sha256: createHash("sha256").update(js.bytes).digest("hex"),
        file: `${folder}/plugin.js`,
        ...(repoName.length > 0 ? { repo: repoName } : {}),
      });

      const manifest = await fetchBytes(manifestUrl);
      if (manifest.ok) {
        await stageFile(resolve(pluginsRoot, folder, "plugin.json"), manifest.bytes);
        staged.push({
          name,
          url: manifestUrl,
          sha256: createHash("sha256").update(manifest.bytes).digest("hex"),
          file: `${folder}/plugin.json`,
          ...(repoName.length > 0 ? { repo: repoName } : {}),
        });
      }

      // The name the adapter will register it under, not the name the index
      // lists it with: the manifest's when it is readable, the folder when it
      // is not — the same two cases, in the same order, that
      // `ShelterPluginManager#prepare` resolves. A row and the console label
      // it attributes have to agree, or a plugin's own warnings land in the
      // run's unattributed bucket instead of on its row.
      const registeredName = manifest.ok ? manifestNameOf(manifest.bytes) : undefined;
      const entryId = `shelter.${folder}`;
      entries.push({
        group: "bulk",
        name: registeredName ?? folder,
        id: entryId,
        url,
        ...(manifest.ok ? {} : { note: `manifest not published: plugin.json ${manifest.reason}` }),
        // A sweep's entries are generated, so they cannot carry the diagnosis
        // the pinned acceptance file holds; the hand-written ones live beside
        // their measured reason, never instead of it.
        ...(SHELTER_INDEX_DIAGNOSES[entryId]
          ? { diagnosis: SHELTER_INDEX_DIAGNOSES[entryId] }
          : {}),
      });
    }
  }

  const resolved = resolveSweepNames(entries);

  // A sweep that staged nothing is a broken sweep, not a measurement. The
  // first sweep got every URL's directory segment dropped by a missing
  // trailing slash and reported all 131 as deferred — the right verdict for
  // each entry, and still not something anyone should read as a score.
  const stagedCount = resolved.filter((entry) => entry.unstaged === undefined).length;
  if (stagedCount === 0) {
    throw new Error(
      `the Shelter index sweep staged nothing (${String(resolved.length)} entries; ` +
        `first reason: ${resolved[0]?.unstaged ?? "unknown"})`,
    );
  }

  // Provenance for a sweep has to be stronger than a pin, because there is
  // none: every file that was staged, with the digest it actually had.
  await writeStaged(artifactsDir, "shelter-index-staged.json", staged);
  // Doubles as the entry list for `--report`, so a sweep can be re-analyzed
  // without re-fetching the catalog. Renaming is idempotent — once the names
  // are unique, a second pass finds nothing contested — so reloading it
  // cannot suffix a name twice.
  await writeStaged(artifactsDir, "shelter-index.json", resolved);
  return resolved;
}

async function runSmoke(
  options: CliOptions,
  smokeOut: string,
  extra: readonly string[],
  profile: RunProfile | null,
  maxWarnings: number,
): Promise<number> {
  const root = repoRoot();
  const args = [
    resolve(root, "scripts", "smoke.mjs"),
    "--out",
    smokeOut,
    "--timeout",
    String(Math.ceil((options.settleMs + SMOKE_MARGIN_MS) / 1000)),
    ...(profile === null ? [] : ["--profile", profile.dir]),
    "--",
    ...extra,
  ];
  return await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      cwd: root,
      // The capture keeps one line per distinct warning; a sweep of a
      // hundred plugins would hit its default and lose the rest, which would
      // quietly turn "pass with warnings" into "pass".
      env: { ...process.env, ION_SMOKE_MAX_WARNINGS: String(maxWarnings) },
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolveExit(code ?? 1);
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) return;

  const root = repoRoot();
  const isBd = options.ecosystem === "bd";
  const isShelter = options.ecosystem === "shelter";
  // File-based ecosystems: staged into a profile, never seeded through
  // settings the way Vencord's are.
  const stagesFiles = isBd || isShelter;
  // An index sweep scores the live catalog, so its entries arrive during
  // staging rather than being read from the checked-in file.
  const usesIndex = options.source === "index";

  let acceptance: readonly AcceptanceEntry[] = [];
  if (usesIndex) {
    // When re-analyzing a past sweep, the entries are the artifact that run
    // wrote — re-fetching the catalog would score today's listing against
    // yesterday's results.
    if (options.reportOnly !== null) {
      const entriesPath = resolve(dirname(dirname(options.reportOnly)), "shelter-index.json");
      acceptance = JSON.parse(await readFile(entriesPath, "utf8")) as AcceptanceEntry[];
    }
  } else {
    const acceptancePath = resolve(
      root,
      "packages",
      ACCEPTANCE_PACKAGES[options.ecosystem],
      "acceptance.json",
    );
    // The Vencord file is a bare array; the BD and Shelter files carry a
    // source/note wrapper around their `entries`.
    const document = JSON.parse(await readFile(acceptancePath, "utf8")) as
      AcceptanceEntry[] | { entries: AcceptanceEntry[] };
    acceptance = Array.isArray(document) ? document : document.entries;
  }

  let upstream: string;
  if (usesIndex) {
    upstream = `live index ${SHELTER_INDEX_URL}`;
  } else if (isBd) {
    upstream = "133bc83 (Apache-2.0 port of BdApi)";
  } else if (isShelter) {
    upstream = "6d42725 (CC0-1.0 uwu/shelter)";
  } else {
    const manifest = JSON.parse(
      await readFile(
        resolve(root, "packages", "compat-vencord", "vendor", "vencord", "MANIFEST.json"),
        "utf8",
      ),
    ) as { source?: { version?: string; commit?: string } };
    upstream = `${manifest.source?.version ?? "unknown"} (${(manifest.source?.commit ?? "unknown").slice(0, 7)})`;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = options.out ?? resolve(root, "compat-runs", stamp);
  const smokeOut = resolve(out, "smoke");
  const reportPath = options.reportOnly ?? resolve(smokeOut, "report.json");
  const docs =
    options.docs ??
    resolve(
      root,
      "docs",
      usesIndex ? INDEX_DOCS_PATHS[options.ecosystem] : DOCS_PATHS[options.ecosystem],
    );

  let profile: RunProfile | null = null;
  try {
    if (options.reportOnly === null) {
      await mkdir(smokeOut, { recursive: true });
      const extra: string[] = [`--ion-smoke-settle-ms=${String(options.settleMs)}`];
      if (stagesFiles) {
        // BetterDiscord and Shelter plugins are files: stage verified copies
        // into an isolated profile this runner owns.
        const dir =
          options.profile ?? (await mkdtemp(join(tmpdir(), `ion-${options.ecosystem}-profile-`)));
        profile = { dir, owned: options.profile === null };
        if (usesIndex) {
          acceptance = await stageShelterIndex(dir, out);
        } else if (isBd) {
          await stageBdPlugins(dir, acceptance, out);
        } else {
          await stageShelterPlugins(dir, acceptance, out);
        }
      } else {
        // Every acceptance plugin enabled: upstream only registers patches
        // for enabled plugins, so a default-off profile would prove nothing.
        extra.push(
          `--ion-seed-vencord-settings=${JSON.stringify({
            plugins: Object.fromEntries(acceptance.map((entry) => [entry.name, { enabled: true }])),
          })}`,
        );
        if (options.profile !== null) profile = { dir: options.profile, owned: false };
      }
      // One line kept per distinct warning: generous for a sweep, which is
      // where a cap would do the most damage by hiding evidence.
      const smokeExit = await runSmoke(
        options,
        smokeOut,
        extra,
        profile,
        Math.max(100, acceptance.length * 50),
      );
      process.stdout.write(`[compat] smoke exited ${String(smokeExit)}\n`);
    }

    let smoke: SmokeReport;
    try {
      smoke = JSON.parse(await readFile(reportPath, "utf8")) as SmokeReport;
    } catch (error) {
      process.stderr.write(
        `[compat] no smoke report at ${reportPath} — the run did not produce one (${String(error)})\n`,
      );
      process.exitCode = 1;
      return;
    }

    const report = analyze(smoke, acceptance, {
      generatedAt: new Date().toISOString(),
      ecosystem: options.ecosystem,
      upstream,
    });
    const markdown = renderCompatMarkdown(report);

    await mkdir(out, { recursive: true });
    await writeFile(resolve(out, "compat-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(docs, markdown);

    const { summary, meta } = report;
    const failed = report.plugins.filter((plugin) => plugin.status === "fail");
    process.stdout.write(
      `[compat] ${String(summary.total)} plugins: ${String(summary.pass)} pass, ` +
        `${String(summary.warnings)} warnings, ${String(summary.fail)} fail, ` +
        `${String(summary.deferred)} deferred · tier2 ` +
        `${meta.tier2Run ? "measured" : "not run"} · scoreboard: ${docs}\n`,
    );
    for (const plugin of failed) {
      process.stderr.write(`[compat] FAIL ${plugin.name}: ${plugin.reason ?? "unknown"}\n`);
    }
    if (!report.runHealthy) {
      // Attributed errors already went out above as that plugin's FAIL line.
      // These are the ones the run could not place — the reason the
      // measurement itself is in doubt rather than just a plugin.
      for (const error of report.run.unattributedRendererErrors) {
        process.stderr.write(`[compat] unattributed renderer error: ${error}\n`);
      }
      process.stderr.write(
        "[compat] run unhealthy: renderer errors no plugin could be blamed for\n",
      );
    }
    if (failed.length > 0 || !report.runHealthy) process.exitCode = 1;
  } finally {
    if (profile?.owned === true) {
      await rm(profile.dir, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`[compat] harness error: ${String(error)}\n`);
  process.exitCode = 1;
}
