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

- Phase 8 commits (Shelter adapter, milestone summaries):

| Commit    | Summary                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `7884af4` | expose `window.shelter` and run staged Shelter plugins                             |
| `08db14e` | find the real dispatcher; load side-effect-only plugins                            |
| `a5e8875` | `--source index` live-catalog sweep                                                |
| `33f4317` | compile `@uwu/shelter-ui` into `shelter.ui`                                        |
| `bdfcd78` | stop dropping every write to a plugin's store (6 plugins recovered)                |
| `a6fd94d` | stage 3: `registerSection` draws into Discord's settings, real React↔Solid bridges |
| `ae41fd1` | scoreboard regenerated after stage 3 — 6 settings warnings now pass                |

- **Phase 8 scoreboard:** starter set **9 pass / 1 warnings / 0 fail**
  (`docs/compat-shelter.md`); live index sweep **109 pass / 11 warnings /
  10 fail / 1 deferred** through a 180 s Tier 2 soak
  (`docs/compat-shelter-index.md`). Remaining: re-measure the sweep with
  stage 3 in, then owner Tier 3.
- **Landed alongside phase 8:** the theme engine (`a72cd68` — header parsing
  for plain CSS/BD/Vencord themes, hot reload, injection waiting for the
  document; `docs/themes.md`) and packaging (`32a8dbe`, `9a18b4b`, `1d74eaa`
  — AppImage, .deb, first-class Arch PKGBUILD/.SRCINFO, Windows checklist;
  `docs/linux.md`). Both test-covered, neither part of a scoreboard.

- **Phase 9 (`44b1b6e`, `ded4898`):** hybrid in-app catalog — Ion Index +
  BetterDiscord API + Shelter shindex, sha256-verified staging into each
  adapter's directory, `ion:fetch-url` IPC with its own host allowlist, a
  Catalog section in the settings panel (`docs/catalog-format.md`).

- Phase 10 commits (Vencord bulk acceptance 32 → 180 plugins, all green:
  typecheck, lint, 730 tests):

| Commit    | Summary                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `d44a5c8` | acceptance.json expanded to every upstream plugin (32 → 180)                                         |
| `d6daaaa` | vendor the full import closure (618 files, sha256-pinned)                                            |
| `5a72860` | build and serve the full plugin set                                                                  |
| `1f05c4b` | core: reject descriptor-less proxy fabrications in module matching (the FluxDispatcher poison)       |
| `76c8c1a` | compat-vencord: eval order, typed native shims, CONNECTION_OPEN `onceReady`, attributed async starts |
| `8169825` | harness: vencord host-id normalization + upstream log attribution                                    |
| `e84b493` | shell: full-text console capture over CDP (Runtime + Log) for smoke runs                             |
| `5a02d43` | diagnoses for all 8 failures, Phase 10 status                                                        |
| `2ae081e` | scoreboard from the 180 s Tier 2 soak                                                                |

- **Phase 10 scoreboard (measured, logged-out, 180 s Tier 2 soak):** **170
  pass, 1 warnings (CommandsAPI init notice), 8 fail, 1 deferred**; tier 1
  177/3, tier 2 172/8; `runHealthy: true` with **0 unattributed renderer
  errors**. Four root causes fixed without loosening a single check
  (react-aria proxy poisoning `FluxDispatcher`, global-object nested scans,
  discovery-time `onceReady`, anonymous async-start rejections); every
  remaining failure carries a one-line `diagnosis` in `acceptance.json` — 3
  force modules the logged-out page never loads, 3 race modules that load
  later, 2 need absent helper apps, plus USRBG's CSP-blocked service (Q8).
  Raw run: `compat-runs/vencord-full/`.

## Done this phase

- Phase 8 re-measure complete: Shelter index sweep **108 pass / 5 warnings / 17 fail / 1 deferred**, `runHealthy: true` (0 unattributed, 0 dropped). The capture truncation bug (20-slot silent slice) was fixed, attribution now matches stack frames (`s://!SHELTER/<folder>:line`), and three expected-error classes carry consumer-named reasons (DiscordFeed's JetBrains Mono stylesheet, toki pona taso's ijo font, Snazzy Shelter's dead-theme 404s). Two CSP grant rounds added for measured needs: jsdelivr `connect-src`+`style-src`+`font-src` (Codeblocks + Revert Font chain) and `cumcordthemes.github.io` `connect-src` (Snazzy manifest). Two posture grants (jsdelivr `script-src` for Pyodide, wildcard `*.github.io` `connect-src` for Snazzy's repo sweep) remain in Q9. Every failure has a one-line diagnosis in `shelter-diagnoses.ts`. Generated scoreboard: `docs/compat-shelter-index.md`.

- Phase 10 complete: Vencord bulk acceptance **170 pass / 1 warnings / 8 fail / 1 deferred**, `runHealthy: true`, tier 1 177/3, tier 2 172/8; every failure carries a diagnosis in `acceptance.json`. Generated scoreboard: `docs/compat.md`.

- **Phase 7 BD bulk measured**: live store (216 plugins) now boots in ~3 min (was hung at 100-150 plugins). Root cause: O(n²) module search in Ion's `waitFor` probe — every late Discord module rescanned the full cache for every pending waiter. v8 profiler showed 81.7% self-time in `everyModule`. Fix (`188677b`): core `waitFor` now threads module `id` into the predicate; compat-bd's probe indexes each late module on arrival — O(1) lookup, no rescan. **Bulk result: 88 pass / 5 warnings / 123 fail / 0 deferred** (180 s Tier 2, logged-out). 52 failures need a signed-in session (Discord modules absent); the rest are by-design (no Node in page), CSP grants awaiting owner (Q8/Q9), or Discord-internal modules. The starter set (7/0/3) is the honest measurable scope until a test account is available. Every failure carries a one-line diagnosis in `bd-diagnoses.ts`. Generated scoreboard: `docs/compat-bd-index.md`.

- Attribution fixes for BD: plugin file origin (`betterdiscord://.../file.plugin.js`) and declared `@source` URL now credit errors (CSP media-src refusals, stack frames under the document) that previously landed in the unattributed bucket.

## In progress

- Owner Tier 3 hand-checks across all scoreboards (Vencord 150 items, BD, Shelter, stage-3 settings) and the open questions in `HUMAN/`.

## Next (dependency order)

1. Owner Tier 3 and `HUMAN/` decisions.
2. First real run of `.github/workflows/vencord-plugins.yml` on GitHub (cannot be executed in this environment — owner-visible in the report).

## Resume point

- Branch `phase-6-8`, tree clean and green (typecheck, lint, 746 tests); all three ecosystem bulk sweeps measured and documented. Everything since `ebd3115` is unpushed — the push happens at the phase milestone, never to `main`.
