/**
 * The catalog client: fetches plugin and theme entries from multiple sources,
 * downloads files, verifies hashes, and stages them for the compat adapters.
 *
 * Three sources are supported:
 *
 * - **Ion Index** (`ion-index/vencord-artifacts/v1`): GitHub Actions–compiled
 *   Vencord plugin artifacts. Each entry has a URL, byte size, and sha256.
 * - **BetterDiscord API** (`api.betterdiscord.app`): the live BD plugin/theme
 *   listing. Each entry has a name, description, author, and download URL.
 * - **Shelter shindex** (`shindex.uwu.network`): the live Shelter plugin index.
 *   Each entry has a name, author, and source URL pointing at `plugin.js`.
 *
 * Downloads go through the main-process fetch bridge (`window.__ION__.fetch`),
 * which bypasses page CSP/CORS. Hashes are verified before staging when the
 * source provides one. Files are written to the adapter's staging directory;
 * adapters scan at boot, so newly staged plugins appear after a restart.
 *
 * The catalog is read-only with respect to the sources: it never writes to
 * remote hosts, and downloads are confined to the Ion data directory.
 */

import type { ShellFetchApi, ShellFileApi } from "./platform/shell";

/** A plugin or theme the catalog can install. */
export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly author: string;
  readonly version?: string;
  readonly source: CatalogSource;
  readonly type: "plugin" | "theme";
  readonly ecosystem: "vencord" | "bd" | "shelter";
  /** Direct download URL for the file. */
  readonly url: string;
  /** Expected sha256 hex digest, when the source publishes one. */
  readonly sha256?: string;
  /** Filename to stage as (including extension). */
  readonly filename: string;
}

export type CatalogSource = "ion-index" | "betterdiscord" | "shelter-index";

/** One page of catalog results. */
export interface CatalogPage {
  readonly entries: readonly CatalogEntry[];
  /** True when more pages are available (pagination cursor). */
  readonly hasMore: boolean;
  /** Cursor for the next page, if any. */
  readonly nextCursor?: string;
}

/** A fetched and hash-verified file, ready to stage. */
export interface CatalogFile {
  readonly entry: CatalogEntry;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** Staging result: success or a failure reason. */
export type StageResult =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string };

/** Fetch wrapper injected by the host (main-process bridge). */
export interface CatalogDeps {
  readonly fetch: ShellFetchApi;
  readonly files: ShellFileApi;
}

// ---------------------------------------------------------------------------
// Source fetchers
// ---------------------------------------------------------------------------

const BD_API = "https://api.betterdiscord.app/v1/store/addons";
const SHELTER_INDEX = "https://shindex.uwu.network/data";
const ION_INDEX_BASE =
  "https://raw.githubusercontent.com/ionclient/ion/ion-index/vencord/artifacts/index.json";

interface BdAddon {
  name: string;
  description?: string;
  author?: { name?: string };
  version?: string;
  download_url?: string;
  file_name?: string;
}

interface ShelterPlugin {
  name: string;
  author?: string;
  url?: string;
}

interface ShelterGroup {
  name?: string;
  plugins?: ShelterPlugin[];
}

interface IonIndexEntry {
  name: string;
  file: string;
  bytes: number;
  sha256: string;
  note?: string;
}

interface IonIndex {
  format: string;
  plugins: IonIndexEntry[];
}

/** Fetch and parse the BetterDiscord addon listing. */
async function fetchBetterDiscord(deps: CatalogDeps): Promise<CatalogEntry[]> {
  const res = await deps.fetch.fetch(BD_API);
  if (!res.ok) throw new Error(`BetterDiscord API returned ${String(res.status)}`);
  const json = (await res.json()) as BdAddon[];
  return json
    .filter((a) => typeof a.download_url === "string")
    .map((a) => ({
      id: `bd-${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: a.name,
      description: a.description ?? "",
      author: a.author?.name ?? "Unknown",
      ...(a.version !== undefined ? { version: a.version } : {}),
      source: "betterdiscord" as const,
      type: a.file_name?.endsWith(".theme.css") ? "theme" : "plugin",
      ecosystem: "bd" as const,
      url: a.download_url ?? "",
      filename: a.file_name ?? `${a.name.replace(/[^a-zA-Z0-9]/g, "")}.plugin.js`,
    }));
}

/** Fetch and parse the Shelter live index. */
async function fetchShelterIndex(deps: CatalogDeps): Promise<CatalogEntry[]> {
  const res = await deps.fetch.fetch(SHELTER_INDEX);
  if (!res.ok) throw new Error(`Shelter index returned ${String(res.status)}`);
  const json = (await res.json()) as ShelterGroup[];
  const entries: CatalogEntry[] = [];
  for (const group of json) {
    for (const plugin of group.plugins ?? []) {
      if (typeof plugin.url !== "string") continue;
      entries.push({
        id: `shelter-${plugin.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: plugin.name,
        description: "",
        author: plugin.author ?? "Unknown",
        source: "shelter-index",
        type: "plugin",
        ecosystem: "shelter",
        url: plugin.url,
        filename: "plugin.js",
      });
    }
  }
  return entries;
}

/** Fetch and parse the Ion Index (Vencord compiled artifacts). */
async function fetchIonIndex(deps: CatalogDeps): Promise<CatalogEntry[]> {
  const res = await deps.fetch.fetch(ION_INDEX_BASE);
  if (!res.ok) throw new Error(`Ion Index returned ${String(res.status)}`);
  const json = (await res.json()) as IonIndex;
  if (json.format !== "ion-index/vencord-artifacts/v1") {
    throw new Error(`Unknown Ion Index format: ${json.format}`);
  }
  return json.plugins.map((p) => ({
    id: `vencord-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: p.name,
    description: p.note ?? "",
    author: "Ion Index",
    source: "ion-index",
    type: "plugin",
    ecosystem: "vencord",
    url: p.file,
    sha256: p.sha256,
    filename: `${p.name.replace(/[^a-zA-Z0-9]/g, "")}.js`,
  }));
}

// ---------------------------------------------------------------------------
// Download + verify
// ---------------------------------------------------------------------------

/** Compute sha256 hex of bytes using Web Crypto. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Download a catalog entry and verify its hash. */
export async function downloadEntry(deps: CatalogDeps, entry: CatalogEntry): Promise<CatalogFile> {
  const res = await deps.fetch.fetch(entry.url);
  if (!res.ok) throw new Error(`Download failed (${String(res.status)})`);
  const text = await res.text();
  const bytes = new TextEncoder().encode(text);
  const actual = await sha256Hex(bytes);
  if (entry.sha256 && actual !== entry.sha256) {
    throw new Error(
      `Hash mismatch for ${entry.name}: expected ${entry.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…`,
    );
  }
  return { entry, bytes, sha256: actual };
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

/** Staging directory per ecosystem. */
const STAGE_DIRS: Record<CatalogEntry["ecosystem"], string> = {
  vencord: "vencord/plugins",
  bd: "bd/plugins",
  shelter: "shelter/plugins",
};

/** Stage a downloaded file into the adapter's staging directory. */
export async function stageFile(deps: CatalogDeps, file: CatalogFile): Promise<StageResult> {
  const dir = STAGE_DIRS[file.entry.ecosystem];
  const path = `${dir}/${file.entry.filename}`;
  try {
    const base64 = bytesToBase64(file.bytes);
    await deps.files.writeFile(path, base64, "base64");
    return { ok: true, path };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fetch all entries from all sources. */
export async function fetchCatalog(deps: CatalogDeps): Promise<CatalogEntry[]> {
  const results = await Promise.allSettled([
    fetchBetterDiscord(deps),
    fetchShelterIndex(deps),
    fetchIonIndex(deps),
  ]);
  const entries: CatalogEntry[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") entries.push(...r.value);
  }
  return entries;
}

/** Fetch entries from a single source. */
export async function fetchSource(
  deps: CatalogDeps,
  source: CatalogSource,
): Promise<CatalogEntry[]> {
  switch (source) {
    case "betterdiscord":
      return fetchBetterDiscord(deps);
    case "shelter-index":
      return fetchShelterIndex(deps);
    case "ion-index":
      return fetchIonIndex(deps);
  }
}
