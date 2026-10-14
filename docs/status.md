# Project status

_Last updated: 2026-10-14. Phase numbers refer to the plan in `AGENTS.md`; this
file is rewritten at each phase boundary, not incrementally patched._

## Done

| Phase | Deliverable                                        | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Workspace, strict TS, lint/format/hooks, packaging | Green: clean-clone `pnpm install --frozen-lockfile` builds and tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1     | Desktop shell (Electron, secure window, tray, IPC) | Live-tested on Wayland + NVIDIA: login/app loads, close-to-tray, single instance, screenshare permission path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2     | Injection, typed IPC bridge, restricted `require`  | Live-tested: core runs in main world at T+~110ms, debug panel docked next to Discord's settings gear                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3     | Webpack discovery + source-text patch engine       | Live-tested: chunk hook intercepts rspack's chain, 6k+ factories wrapped, `findStore("UserStore")` and friends hit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4     | Settings store + native plugin host                | Live-tested: bundled `ion.diagnostics` starts at boot (`1/1 started`), toggle/stop/patch-removal paths unit-tested                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5     | In-Discord UI foundation (settings page)           | Live-tested headlessly: Ion tab injected into the real settings sidebar; panel renders inside Discord's native scroller with native-matched controls (switches, selects)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6     | Vencord/Equicord adapter + acceptance scoreboard   | Measured: 32/32 plugins load on a logged-out session (30 pass, 1 warnings, 0 fail, 1 deferred) through a 180s Tier 2 soak; generated `docs/compat.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 7     | BetterDiscord adapter (`BdApi`, plugin/theme load) | Measured: 10-plugin starter set on a logged-out session, 7 pass / 0 warnings / 3 fail / 0 deferred through a 180s Tier 2 soak; generated `docs/compat-bd.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 8     | Shelter adapter + bulk scoreboard                  | **In progress.** Live index sweep measured 109 pass / 11 warnings / 10 fail / 1 deferred through a 180 s Tier 2 soak ([compat-shelter-index.md](./compat-shelter-index.md); starter set 9/1/0 in [compat-shelter.md](./compat-shelter.md)). Stage 2 (`shelter.ui` = real `@uwu/shelter-ui`, both settings dialogs) and stage 3 (`registerSection` drawing + both React↔Solid bridges, see [shelter-stage3.md](./shelter-stage3.md)) are in; the plugin-store write bug is fixed (6 plugins recovered) and two CSP grant rounds recovered 2 more. Remaining: re-measure the sweep with stage 3 in, then owner Tier 3 |
| 9     | In-app catalog browser                             | Committed: hybrid fetch from the Ion Index, BetterDiscord's API and Shelter's shindex, sha256-verified staging into each adapter's directory, `ion:fetch-url` IPC with its own host allowlist, Catalog section in the settings panel ([catalog-format.md](./catalog-format.md)). Covered by tests; the live install flow is owner Tier 3 — no scoreboard applies.                                                                                                                                                                                                                                                   |
| 10    | Vencord bulk acceptance (180 plugins)              | Measured: **170 pass / 1 warnings / 8 fail / 1 deferred** through a 180 s Tier 2 soak, `runHealthy: true` (0 unattributed renderer errors), every failure carrying a one-line diagnosis; tier 1 177/3, tier 2 172/8. Generated scoreboard: [compat.md](./compat.md). Remaining: owner Tier 3 and the Q8 CSP decision.                                                                                                                                                                                                                                                                                               |

Design details live in [architecture.md](./architecture.md); writing plugins
against the host in [plugin-authoring.md](./plugin-authoring.md); Linux
specifics (including the screenshare system-audio limitation) in
[linux.md](./linux.md).

Landed alongside phase 8: the theme engine (header parsing for plain CSS,
BetterDiscord and Vencord themes, hot reload, injection that waits for the
document — see [themes.md](./themes.md)) and packaging (see
[linux.md](./linux.md)). Both are covered by tests but were not part of a
measured scoreboard.

## Phase 6 — Vencord/Equicord adapter

**What runs.** `packages/compat-vencord` vendors the upstream import closure of
180 acceptance plugins (every plugin upstream's own build rules ship for a
Vesktop-shaped renderer with `IS_DEV=false`: Vencord 1.15.11 @ `16ec4ea`,
618 files, sha256-pinned in
`vendor/vencord/MANIFEST.json`, license texts included, `tools/vendor.mjs --check`
enforced), translates each definition into an Ion plugin manifest (upstream's
`startAt` → Ion stages, implicit API dependencies, `$self` binding), and ships as
one IIFE that the shell injects after core and ui. `window.Vencord` mirrors
upstream's renderer namespace; `window.VencordNative` is Ion's shim
(localStorage-backed settings and quickCss, themes now backed by Ion's own
theme engine — see docs/themes.md — `openExternal` via the shell, clipboard
intentionally absent — no token-adjacent surface).

**Measured result** (fresh isolated profile, no login, all 32 enabled through
the settings seed, 180s read-only soak): 33/33 plugins registered (32 Vencord +
ion.diagnostics), 0 failed, `rendererErrors: []`, 112 patches registered with
zero error notices. Scoreboard with per-plugin reasons and the owner's Tier 3
checklist is generated at [`compat.md`](./compat.md). Known, explained,
non-failing observations:

| Observation                                                                  | Classification                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `[CommandsAPI] Not registering petpet … please restart` (3 warnings)         | Login-dependent: Discord's builtin-commands module never evaluates while logged out. Tier 3 must confirm `/petpet` after login. |
| `[ion] [webpack] findModuleId found no factory` (UserSettingsAPI lazy chunk) | Logged-out chunk never loads; runs on the app session.                                                                          |
| NoTrack aborts Sentry's module evaluation                                    | By design — recorded in `expectedErrors`, not a failure.                                                                        |
| WebScreenShareFixes                                                          | Deferred (Q3): blocked on Linux screenshare system audio.                                                                       |
| Electron CSP security warning                                                | Disabled for harness runs (`ELECTRON_DISABLE_SECURITY_WARNINGS`); describes Discord's own `unsafe-eval` policy.                 |

**Group C decision (plugin vs native)** — all six stay real Vencord plugins in
the compat layer; none gets an Ion-native reimplementation now:

| Plugin              | Decision                     | Why                                                                                 |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| WebKeybinds         | Vencord plugin (compat)      | Upstream web-target behavior; vendor refreshes keep it fixed.                       |
| WebContextMenus     | Vencord plugin (compat)      | Same — Electron's native menus already work; this adds upstream's web-style items.  |
| WebScreenShareFixes | Vencord plugin, **deferred** | Functionality depends on screenshare audio parity (Q3); not claimed until then.     |
| DisableDeepLinks    | Vencord plugin (compat)      | One handler; native later only if a real benefit appears.                           |
| NoTrack             | Vencord plugin (compat)      | Real Vencord feature; its Sentry abort is a classified by-design error (see above). |
| AddAttachments      | Vencord plugin (compat)      | Real Vencord feature (URL → attachment).                                            |

**Ion Index artifacts (cloud compilation).** `pnpm --filter @ion/compat-vencord
build` emits `dist/artifacts/<plugin>.js` × 32 plus `index.json` (name, size,
sha256; byte-reproducible — `BUILD_TIMESTAMP` pinned). The artifact contract:
evaluate the file, then call `Vencord.registerPluginDefinition(window.__ION_VENCORD_PLUGIN__)`.
`@api/*` is externalized to the runtime's `window.Vencord.Api` so listeners and
store instances are shared, never split-brain. Verified end-to-end over CDP
against a live session. The GitHub Actions workflow
(`.github/workflows/vencord-plugins.yml`) verifies the vendor tree, builds, and
publishes to an `ion-index/vencord/<version>` release — **written but not run
here; its first real execution is untested.**

## Phase 10 — Vencord/Equicord bulk acceptance (180 plugins)

**What runs.** The acceptance set grew from the 32-plugin starter set to all
180 plugins upstream's own build rules ship (`packages/compat-vencord/
acceptance.json`; `group: "bulk"` entries appended by the generator, hand-
written A–D entries untouched). Debugging the bulk run exposed and fixed four
root causes, each with a regression test:

| Root cause                                                                                                                                                                                                                                                                                                               | Fix                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react-aria's defaulting context proxy answered every property, so upstream's own `waitFor(["dispatch", "subscribe"])` delivered it as `FluxDispatcher` on the logged-out page (it executes before the real dispatcher) and poisoned every flux plugin, silently — the listener's throw was swallowed by the getter guard | `filters.byProps` now requires a real property descriptor (own or prototype chain); `waitFor` logs listener throws instead of swallowing them (`packages/core/src/webpack/`)                              |
| Every nested scan descended into the global-object module (`window` itself), reading side-effecting page getters and re-matching poisoned values                                                                                                                                                                         | nested scans skip the global object's exports; throwing filters are a miss, not a failed search                                                                                                           |
| The shim settled `onceReady` at discovery time, so `consoleShortcuts` eager-loaded component lazies on the login page (17 unattributed "could not find the X Component" errors)                                                                                                                                          | `onceReady` settles only on gateway `CONNECTION_OPEN`, exactly like upstream                                                                                                                              |
| An async `start()` rejection surfaced as an anonymous unhandled rejection                                                                                                                                                                                                                                                | the adapter logs it under the plugin's name (upstream's started semantics untouched); the smoke captures full console text plus stacks over CDP instead of the 160-char-truncated `console-message` event |

**Measured result** (fresh isolated profile, no login, all 180 enabled, 180 s
read-only Tier 2 soak): 181/181 registered, 178 started, 3 start failures, 5
attributed async-start rejections, 0 unattributed renderer errors
(`runHealthy: true`). Scoreboard at [`compat.md`](./compat.md): 170 pass, 1
warnings (CommandsAPI's own init-ordering notice), 8 fail, 1 deferred; tier 1
177/3, tier 2 172/8. Every
failure carries a one-line `diagnosis` in `acceptance.json`: 3 force modules
the logged-out page never loads (UserSettings catalog, API Endpoints,
WindowStore), 3 race modules that load later (FluxDispatcher,
SelectedGuildStore, Notices store), and 2 need absent external apps (arRPC bridge on :1337,
XSOverlay on :42070); USRBG's service fetch is refused by Discord's
`connect-src` CSP, whose grant is an owner decision (Q8). Tier 3 (owner,
logged-in, 150 items) is unchanged.

## Phase 7 — BetterDiscord adapter

**What runs.** `packages/compat-bd` ports the `BdApi` surface BetterDiscord
plugins actually call — webpack discovery and filters, the patcher (same
validation order and error messages), `Data`/`DOM`/`Logger`/`Net`/`UI`/`Utils`/
`ReactUtils`/`ContextMenu`/`Hooks`/`Components` — plus the addon managers behind
`BdApi.Plugins` and `BdApi.Themes`, reading `bd/*.plugin.js` and `bd/themes/*.css`
from the profile. 50 source files adapted from BetterDiscord `133bc83`
(Apache-2.0); every deliberate difference is listed under "Deviations from
upstream BetterDiscord" in [THIRD_PARTY.md](../THIRD_PARTY.md).

Plugins evaluate at their **start** stage rather than at load, so a file whose
module cannot be evaluated reports a load failure carrying the reason
(`failed to evaluate — …`, `constructor threw — …`) instead of disappearing into
a silent skip.

**Measured result** (starter set from `packages/compat-bd/acceptance.json`,
sha256-pinned before staging, fresh isolated profile, no login, 180s read-only
Tier 2 soak): 7 pass, 0 warnings, 3 fail, 0 deferred. Scoreboard with per-plugin
reasons, the owner's Tier 3 checklist, and a hand-written diagnosis beside each
failure is generated at [`compat-bd.md`](./compat-bd.md).

| Failure       | One-line reason                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BetterFolders | Reads Discord's guild-list CSS module (`byKeys(["guilds", "base"])`) at start; absent from the logged-out login build, so it cannot be attributed here — re-measure signed in.          |
| LiveTyping    | Patches a Discord export (`ChannelElement.A`) that the current build exposes as a getter-only accessor; upstream's Patcher makes the same plain assignment and fails identically.       |
| ChannelTabs   | Registers and starts, then throws on its own logged-out retry path — it reads an undeclared `config` when no user is present, leaving `this.settings` unset for the later `onSwitch()`. |

None of the three is an exclusion: all three stay on the scoreboard as failures.
BetterFolders and ChannelTabs are logged-out-limited and need a signed-in
session before they can be called anything other than failed.

**Discord deletes `window.localStorage`.** Its own client removes the property
from the window after its scripts run, keeping references it captured first.
Any code reaching for `window.localStorage` late therefore finds `undefined`:
`BdApi.Data` threw on every write and Vencord's settings silently fell back to
defaults — four BetterDiscord plugins failed this way. Core now captures a
working reference before Discord's first script and exposes it as
`window.__ION__.storage`; both adapters persist through it. The smoke report
records `domStorage` — the captured backend alongside whether the page still
exposes the property — so a regression like this shows up as one field instead
of a stack of plugin failures. Measured after the fix:
`{"backend":"localStorage","pageExposesLocalStorage":"undefined"}`.

**What could not be verified here.** The session is logged out, so the guild
sidebar the two logged-out-limited plugins need does not exist; the settings-tour
probes (`gearFound`, `ionTabMounted`, …) are likewise expected to be false at
`/login`. Tier 3 hand-checks are the last column of `compat-bd.md`.

## Phase 8 — Shelter adapter (in progress)

**What runs.** `packages/compat-shelter` evaluates a Shelter plugin's source
against a `shelter` global built to upstream's shapes (`6d42725f`, CC0-1.0;
every deliberate difference listed in [THIRD_PARTY.md](../THIRD_PARTY.md)).

**Measured, live index sweep, 131 plugins, 180 s Tier 2 soak: 109 pass, 11
warnings, 10 fail, 1 deferred** (generated at
[`compat-shelter-index.md`](./compat-shelter-index.md)). That is 6 plugins
above the first post-attribution sweep (101 pass / 18 fail) — 8 plugins recovered in total. Each recovered
plugin and each remaining failure has a one-line reason on the scoreboard — the
sweep's entries are generated, so the recurring ones are diagnosed in
`compat-harness/src/shelter-diagnoses.ts`, each written against the plugin's own
published source.

What the runs actually bought, in order:

- **Stage 2 (`shelter.ui` = the real `@uwu/shelter-ui`)** cleared the two
  `shelter.ui.showToast is not available` blockers (Declutter, shelteRPC).
- **The plugin store was dropping every write.** `shelter.plugin.store` was
  Solid's `createStore` proxy handed over as-is, and in solid-js 1.6.16 that
  proxy's `set` trap is a no-op that only warns (`Cannot mutate a Store
directly`). Any plugin that seeded its own store and read it back threw
  `store.watchedGuilds is not iterable` or `reading 'length'` with nothing
  naming the cause. Reproduced in a unit probe first (`store.x = []` then
  `Array.isArray` → `false`), then the store was wrapped so writes route by key
  path through the setter that came with it — Solid keeps its reactivity, array
  handling and `unwrap`, and no valtio dependency is needed. Upstream uses
  valtio here; the difference is recorded under "Deviations from upstream
  Shelter" in [THIRD_PARTY.md](../THIRD_PARTY.md). **This was the largest single
  cause of failure in the sweep, and fixing it recovered 6 plugins.**
- **Two CSP grant rounds**, added one failure at a time rather than up front:
  `raw.githubusercontent.com` (connect+img) + `userpfp.github.io` (connect)
  recovered UserPFP outright (`Failed to fetch` → pass) and cleared tarp's data
  load; then loopback spelled `localhost`, which both Intiface plugins need to
  reach a local service. Each grant names its consumer in the table in
  [architecture.md](./architecture.md), which had no CSP section before, and a
  test pins the boundary so anything outside the table still fails and has to
  come back to be reviewed.

**Remaining 10 failures**, by cause, each with a one-line reason on the
scoreboard: three logged-out limits (Server Clock, Profile Theming and No Nitro
Upsell await a user or a dispatch that never happens on `/login`); Discord APIs
absent from the login build (`DiscordNative`, `MaskedLinkStore`,
`getSuperProperties`); plugins reading helpers only shelter's own loader
provides (`createChangelogButton`, `scoped.ui.showToast` — which upstream never
exposed either); one plugin (Codeblocks Plus Reloaded) whose jsdelivr assets
Discord's CSP blocks; and one parsed-JSON failure not yet isolated.

**Not done, and said plainly.**

- Stage 3 is **implemented** (`registerSection` draws into Discord's settings; both
  React↔Solid bridges are real) and covered by unit tests
  ([shelter-stage3.md](./shelter-stage3.md)) — but no test in this repo opens
  Discord's settings modal, because that needs a signed-in session. Whether the rows
  actually render is a Tier 3 item for the owner, with a checklist in that doc. The
  sweep after stage 3 is what moves (or does not move) the six settings warnings.
- Tier 3 (owner hand-checks) has not run. Every number above is Tier 1 + Tier 2
  automated, on a logged-out session; the three login-dependent plugins cannot
  be scored as anything but failed until a signed-in run exists.

## How to run the compatibility scoreboard

```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm build
pnpm --filter @ion/compat-harness report                       # Vencord: 32 plugins → docs/compat.md
pnpm --filter @ion/compat-harness report -- --ecosystem bd     # BetterDiscord: 10 → docs/compat-bd.md
pnpm --filter @ion/compat-harness report -- --ecosystem shelter --source index
                                                               # Shelter: 131 → docs/compat-shelter-index.md
```

Exit code 0 means a healthy run with no failed plugins (warnings and the
documented deferral are recorded, never hidden); a run with any failure exits 1
and still writes the scoreboard. Artifacts land in `compat-runs/<timestamp>/`
(gitignored); re-score an existing run with `--report <smoke-report.json>`.
Tier 3 (owner hand-checks) is the checklist in the last column of
`docs/compat.md` and `docs/compat-bd.md` — nothing in either file is
Tier-3-verified.

## Next

- Vencord bulk acceptance (phase 10) is measured and committed: 170 pass /
  1 warnings / 8 fail / 1 deferred through the 180 s Tier 2 soak, every
  failure diagnosed in `acceptance.json` and rendered in
  [compat.md](./compat.md). Remaining: owner Tier 3 hand-checks (150 items)
  and the Q8 decision (grant `usrbg.is-hardly.online` connect-src or leave
  USRBG blocked).
- The catalog browser is in and committed (`ion:fetch-url` IPC, CSP grants,
  core catalog client, UI section). Remaining: owner Tier 3 hand-checks
  (across all scoreboards), the stage-3 settings checklist, and the open
  questions Q1–Q8 in `QUESTIONS.md`.
- Packaging is in (AppImage, .deb, PKGBUILD/.SRCINFO for Arch — see
  [linux.md](./linux.md)); Windows is config plus an untested checklist.
- Pending decision: Linux screenshare system audio (Electron has no loopback
  on Linux) — documented workaround, owner sign-off open (Q3); also blocks
  WebScreenShareFixes.
