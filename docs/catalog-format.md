# Catalog format

The Ion catalog is a hybrid: it pulls from three sources and presents them as
one browsable list. Each source has its own format; the catalog client
(`packages/core/src/catalog.ts`) normalizes them into a single `CatalogEntry`
type.

## Sources

| Source          | URL                                                                  | Format                           | Hash-verified |
| --------------- | -------------------------------------------------------------------- | -------------------------------- | ------------- |
| Ion Index       | `raw.githubusercontent.com/…/ion-index/vencord/artifacts/index.json` | `ion-index/vencord-artifacts/v1` | Yes (sha256)  |
| BetterDiscord   | `api.betterdiscord.app/v1/store/addons`                              | JSON array                       | No            |
| Shelter shindex | `shindex.uwu.network/data`                                           | JSON array                       | No            |

### Ion Index

Published by GitHub Actions (`.github/workflows/vencord-plugins.yml`) to a
GitHub release. The `index.json` asset:

```json
{
  "format": "ion-index/vencord-artifacts/v1",
  "upstream": { "repository": "…", "commit": "…", "version": "…" },
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "plugins": [
    {
      "name": "PluginName",
      "group": "bulk",
      "folder": "PluginName",
      "file": "https://…/PluginName.js",
      "bytes": 1234,
      "sha256": "abc123…",
      "note": "Optional note"
    }
  ]
}
```

The artifact contract: evaluate the file, then call
`Vencord.registerPluginDefinition(window.__ION_VENCORD_PLUGIN__)`.

### BetterDiscord API

Returns a JSON array of addons. Each addon has `name`, `description`,
`author.name`, `version`, `download_url`, and `file_name` (used to detect
themes by `.theme.css` suffix).

### Shelter shindex

Returns a JSON array of groups, each with a `plugins` array. Each plugin has
`name`, `author`, and `url` (pointing at `plugin.js`).

## Download and install

1. **Fetch** — the catalog client calls `window.__ION__.fetch(url)`, which goes
   through the main-process `ion:fetch-url` IPC channel. This bypasses page
   CSP/CORS; the main process validates the URL against an independent host
   allowlist (`isAllowedFetchUrl`).
2. **Verify** — when the source provides a sha256, the downloaded bytes are
   hashed with Web Crypto and compared. A mismatch throws.
3. **Stage** — the file is written to the adapter's staging directory:
   - Vencord plugins → `vencord/plugins/<filename>`
   - BetterDiscord plugins → `bd/plugins/<filename>`
   - Shelter plugins → `shelter/plugins/<filename>`
4. **Restart** — adapters scan their staging directories at boot, so newly
   staged plugins appear after restarting Ion. The UI says this plainly.

## Entry type

```typescript
interface CatalogEntry {
  id: string; // stable unique id
  name: string; // display name
  description: string; // short description
  author: string; // author name
  version?: string; // semantic version, when known
  source: "ion-index" | "betterdiscord" | "shelter-index";
  type: "plugin" | "theme";
  ecosystem: "vencord" | "bd" | "shelter";
  url: string; // direct download URL
  sha256?: string; // expected hash, when the source provides one
  filename: string; // staging filename (with extension)
}
```
