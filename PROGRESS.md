# PROGRESS

Live log for the phase-6-8 run. Updated at every commit/milestone.

- Branch: `phase-6-8` (tracks origin/phase-6-8). Base: `27851ca` (main).
- Rule: never commit/push/merge to main; no force-push; no `--no-verify`.

## Done

- Phases 0-5 committed and pushed on `main` (`27851ca` and earlier).
- Phase 6 commits on this branch (all green: typecheck, lint, 276 tests):

| Commit    | Summary                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------- |
| `3836757` | shell: `--ion-profile` isolated-run flag                                                          |
| `9105b1a` | shell: inject the optional compat-vencord bundle                                                  |
| `2cda05b` | core: per-plugin patch telemetry (`window.__ION__.patches.stats()`)                               |
| `79e9e2a` | docs: plugin capability surface, phase 7/8 proposals (QUESTIONS)                                  |
| `68b09fa` | shell: `scripts/smoke.mjs` isolated-profile runner                                                |
| `274b1ae` | core: dependency resolution + force-enabled required plugins                                      |
| `c39d1f3` | harness: minimal CDP client                                                                       |
| `fddb0b0` | core: `window.__ION__.discovery` adapter surface                                                  |
| `98c023f` | core: startAt stages, enabledState seam, pre-stage patch phase                                    |
| `0b1beb3` | compat-vencord: vendor closure of the 32 acceptance plugins                                       |
| `16a0764` | core: upstream-parity proxyLazy (retry + same-tick destructuring)                                 |
| `277252d` | core: adapter host surface (optional-field types, findAll options, stage-gated late registration) |
| `d83b6f1` | compat-vencord: vendor closure extended to adapter's own imports                                  |
| `34b4373` | compat-vencord: translate + bundle the 32 acceptance plugins (src, shims, build.mjs, deps)        |
| `6e50310` | shell: CSP grants for *.vencord.dev (BadgeAPI)                                                    |
| `49f77c7` | shell: by-design errors classified into `expectedErrors`                                          |
| `dae7cc3` | docs: record the phase 6 adapter progress and resume point                                        |
| `c5d2f63` | shell: harness seed, settle and richer smoke reports                                              |
| `d0e69f9` | compat-vencord: plugin names + Tier 3 hand-check lines in acceptance.json                         |
| `22dbc32` | compat-vencord: drop the implicit self-dependency edge (BadgeAPI self-cycle warning)              |
| `2127b13` | shell: report the smoke soak window and plugin failure text                                       |
| `334d2fc` | compat-harness: classify smoke runs into per-plugin verdicts + generated docs/compat.md           |
| `fefa522` | compat-vencord: license texts ship with the vendor tree (320 files, `--check` green)              |
| `64171c8` | compat-vencord: per-plugin Ion Index artifacts + `registerPluginDefinition` install hook          |
| `394cb1d` | ci: Vencord artifact compilation workflow (written, not yet run on GitHub)                        |

- **Phase 6 scoreboard (measured, logged-out, 180s Tier 2 soak):** 32/32
  registered and started, **30 pass, 1 pass-with-warnings (CommandsAPI —
  login-dependent command registration), 0 fail, 1 deferred
  (WebScreenShareFixes, Q3)**, `rendererErrors: []`, 112 patches, zero
  error-level notices, expectedErrors = {NoTrack Sentry abort: 1}.
  Generated with reasons + the owner's Tier 3 checklist at
  `docs/compat.md`; raw run in `compat-runs/tier12-2/`.
- Artifact contract verified end-to-end over CDP: petpet artifact evaluated
  with zero exceptions, def handoff → `Vencord.registerPluginDefinition`
  returned `true`, probe registered as `stopped` (disabled by default).
  `dist/artifacts/` is byte-reproducible (sha256 stable across rebuilds).
- THIRD_PARTY.md now records the vendored tree, discord-types (LGPL-3.0-or-later
  with its LICENSE), the six npm runtime deps, and the upstream CSP reference.
- docs/status.md rewritten at the phase boundary: Phase 6 row, Group C
  decision table (all six = real Vencord plugin, WebScreenShareFixes deferred),
  VencordNative shim decisions, smoke + scoreboard how-to.

- Phase 7 commits on this branch (typecheck, lint, 560 tests green):

| Commit    | Summary                                                             |
| --------- | ------------------------------------------------------------------- |
| `7465bbc` | compat-bd: scaffold the adapter with the `BdApi` surface            |
| `ea07c4e` | compat-bd: `BdApi.Webpack` module-search facade                     |
| `32892c1` | compat-bd: `BdApi.Patcher` monkey-patch engine (upstream port)      |
| `d47ad3c` | compat-bd: `BdApi.Utils`, `BdApi.DOM`, `BdApi.Data`                 |
| `d3c7ffc` | compat-bd: React/ReactUtils, UI, Net, ContextMenu, Hooks            |
| `fc7b89d` | compat-bd: load BetterDiscord plugins from `bd/plugins`             |
| `9bea2e7` | core: the theme engine                                              |
| `d07b49e` | compat-bd: load `bd/themes`, expose `BdApi.Plugins`/`BdApi.Themes`  |
| `743622a` | shell: pass request objects to the fs path scoper                   |
| `02fed7e` | harness: `--ecosystem bd` with a measured BetterDiscord scoreboard  |
| `822e200` | compat-bd: `BdApi.Components` and `require("events")`               |
| `03da438` | compat-bd: evaluate BD plugins at their start stage, not at load    |
| `abf044e` | core: capture DOM storage before Discord deletes it (both adapters) |
| `b926524` | compat-bd: export EventEmitter in Node's CJS shape                  |
| `1ce841f` | shell: report which DOM storage the page kept                       |
| `52ff4b2` | harness: a hand-written diagnosis beside the measured reason        |

- **Phase 7 scoreboard (measured, logged-out, 180s Tier 2 soak, starter set of
  10 sha256-pinned plugins):** **7 pass, 0 warnings, 3 fail, 0 deferred.**
  Failures, each explained on the scoreboard and none excluded: BetterFolders
  and ChannelTabs are logged-out-limited, LiveTyping hits a getter-only Discord
  export that upstream's Patcher also cannot write. Generated with reasons,
  diagnoses and the owner's Tier 3 checklist at `docs/compat-bd.md`; raw run in
  `compat-runs/bd-post-storage/`.
- **Root-caused and fixed mid-phase:** Discord's client deletes
  `window.localStorage` from the window after its own scripts run. Anything
  reaching for it late found `undefined` — `BdApi.Data` threw on every write and
  Vencord's settings fell back to defaults (4 of the 10 plugins failed this way
  before `abf044e`). Core now captures the reference at injection and exposes
  it as `window.__ION__.storage`; the smoke report records `domStorage` so the
  condition stays visible: `{"backend":"localStorage","pageExposesLocalStorage":
"undefined"}`.
- THIRD_PARTY.md records the BetterDiscord port (Apache-2.0 @ `133bc83`),
  its vendored stylesheet, lucide icon geometry (ISC), and a "Deviations from
  upstream BetterDiscord" section covering every deliberate difference.

## In progress

- Phase 8: Shelter adapter (`packages/compat-shelter`) + the bulk harness pass
  (every plugin each source offers, scored into one generated doc).

## Next (dependency order)

1. Phase 8 (Shelter adapter + bulk scoreboard), then extend the generated docs
   with those ecosystems.
2. Theme engine hardening (plain CSS/BD/Vencord headers/hot reload), catalog
   browser (Ion Index + live APIs), packaging (AppImage/.deb/PKGBUILD +
   Windows installer config + manual test checklist).
3. First real run of `.github/workflows/vencord-plugins.yml` on GitHub
   (cannot be executed in this environment — owner-visible in the report).

## Resume point

- Branch `phase-6-8`, tree clean and green (typecheck, lint, 560 tests);
  latest isolated harness run is the Phase 7 scoreboard above (3 failures
  recorded, not hidden). Everything through `52ff4b2` is unpushed — the push
  happens at the phase milestone, never to `main`.
- Next exact step: scaffold `packages/compat-shelter` — Shelter's addon
  format (JSON manifest + module function), its `api` surface, and the
  `PluginFormatAdapter` registration into the host, with unit tests before any
  live run; then point the harness at the full Shelter list for the bulk pass.
