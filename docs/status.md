# Project status

_Last updated: 2026-10-13. Phase numbers refer to the plan in `AGENTS.md`; this
file is rewritten at each phase boundary, not incrementally patched._

## Done

| Phase | Deliverable                                        | State                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Workspace, strict TS, lint/format/hooks, packaging | Green: clean-clone `pnpm install --frozen-lockfile` builds and tests                                                                                                                                                                                                                                                                                                                                                                       |
| 1     | Desktop shell (Electron, secure window, tray, IPC) | Live-tested on Wayland + NVIDIA: login/app loads, close-to-tray, single instance, screenshare permission path                                                                                                                                                                                                                                                                                                                              |
| 2     | Injection, typed IPC bridge, restricted `require`  | Live-tested: core runs in main world at T+~110ms, debug panel docked next to Discord's settings gear                                                                                                                                                                                                                                                                                                                                       |
| 3     | Webpack discovery + source-text patch engine       | Live-tested: chunk hook intercepts rspack's chain, 6k+ factories wrapped, `findStore("UserStore")` and friends hit                                                                                                                                                                                                                                                                                                                         |
| 4     | Settings store + native plugin host                | Live-tested: bundled `ion.diagnostics` starts at boot (`1/1 started`), toggle/stop/patch-removal paths unit-tested                                                                                                                                                                                                                                                                                                                         |
| 5     | In-Discord UI foundation (settings page)           | Live-tested headlessly: Ion tab injected into the real settings sidebar; panel renders inside Discord's native scroller with native-matched controls (switches, selects)                                                                                                                                                                                                                                                                   |
| 6     | Vencord/Equicord adapter + acceptance scoreboard   | Measured: 32/32 plugins load on a logged-out session (30 pass, 1 warnings, 0 fail, 1 deferred) through a 180s Tier 2 soak; generated `docs/compat.md`                                                                                                                                                                                                                                                                                      |
| 7     | BetterDiscord adapter (`BdApi`, plugin/theme load) | Measured: 10-plugin starter set on a logged-out session, 7 pass / 0 warnings / 3 fail / 0 deferred through a 180s Tier 2 soak; generated `docs/compat-bd.md`                                                                                                                                                                                                                                                                               |
| 8     | Shelter adapter + bulk scoreboard                  | **In progress.** Live index sweep measured 102 pass / 11 warnings / 17 fail / 1 deferred through a 180 s Tier 2 soak ([compat-shelter-index.md](./compat-shelter-index.md); starter set 9/1/0 in [compat-shelter.md](./compat-shelter.md)). Stage 2 (`shelter.ui` = real `@uwu/shelter-ui`, both settings dialogs) is in and its showToast blockers recovered. Blocking item: the plugin store drops every write — verified, not yet fixed |

Design details live in [architecture.md](./architecture.md); writing plugins
against the host in [plugin-authoring.md](./plugin-authoring.md); Linux
specifics (including the screenshare system-audio limitation) in
[linux.md](./linux.md).

## Phase 6 — Vencord/Equicord adapter

**What runs.** `packages/compat-vencord` vendors the upstream import closure of
32 acceptance plugins (Vencord 1.15.11 @ `16ec4ea`, 320 files, sha256-pinned in
`vendor/vencord/MANIFEST.json`, license texts included, `tools/vendor.mjs --check`
enforced), translates each definition into an Ion plugin manifest (upstream's
`startAt` → Ion stages, implicit API dependencies, `$self` binding), and ships as
one IIFE that the shell injects after core and ui. `window.Vencord` mirrors
upstream's renderer namespace; `window.VencordNative` is Ion's shim
(localStorage-backed settings and quickCss, themes/updater reported as
"handled by Ion", `openExternal` via the shell, clipboard intentionally
absent — no token-adjacent surface).

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

**Measured, live index sweep, 131 plugins, 180 s Tier 2 soak: 102 pass, 11
warnings, 17 fail, 1 deferred** (generated at
[`compat-shelter-index.md`](./compat-shelter-index.md)). That is up from
101/18 on the first post-attribution sweep. Each recovered plugin and each
remaining failure has a one-line reason on the scoreboard — the sweep's
entries are generated, so the recurring ones are diagnosed in
`compat-harness/src/shelter-diagnoses.ts`, each written against the
plugin's own published source.

What the run actually bought:

- **Stage 2 (`shelter.ui` = the real `@uwu/shelter-ui`)** cleared the two
  `shelter.ui.showToast is not available` blockers (Declutter, shelteRPC). Both
  now start past the toast and fail later on the store defect below, so the
  adapter gap is closed and what remains is a different, measured thing.
- **CSP grants**: `raw.githubusercontent.com` (connect+img) and
  `userpfp.github.io` (connect) were added to the policy extension, which is
  what let UserPFP's data load. Measured effect: UserPFP went from
  `Failed to fetch` to **pass** — one plugin recovered outright. tarp cleared
  the same fetch and now fails later on the store defect.
- **A real Ion defect, found and verified but deliberately not yet fixed: the
  plugin store drops every write.** `shelter.plugin.store` is a Solid
  `createStore` proxy, and in solid-js 1.6.16 that proxy's `set` trap is a
  no-op that only console-warns (`Cannot mutate a Store directly`), which was
  reproduced in a unit probe: `store.watchedGuilds = []` then
  `Array.isArray(store.watchedGuilds)` → `false`. Upstream Shelter uses a
  valtio proxy instead, which is mutable. Any plugin that seeds its own store
  and reads it back therefore throws `reading 'length'` / `is not iterable`:
  ServerSentinel, replace-user-pfp, tarp, and (by the same error shape, not
  isolated) clean-home, shelteRPC, IntifaceWebSoundboard. **This is the single
  largest remaining cause of failure in the sweep** and is the next thing to
  fix once work resumes on it; it is left as measured failures on the
  scoreboard rather than worked around by loosening anything.
- Remaining failures outside that: logged-out limits (Server Clock, Profile
  Theming and No Nitro Upsell await a user or a dispatch that never happens on
  `/login`), Discord APIs absent from the login build
  (`DiscordNative`, `MaskedLinkStore`, `getSuperProperties`), plugins that read
  helpers only shelter's own loader provides (`createChangelogButton`,
  `scoped.ui.showToast` — which upstream never exposed either), and one plugin
  whose jsdelivr assets Discord's CSP still blocks.

**Not done, and said plainly.** Stage 3 — `registerSection` drawing into
Discord's settings, and the two React↔Solid bridges — is not started: the 11
warnings are plugins whose settings sections are accepted and kept but not
rendered, which is exactly that gap reporting itself. Both still fail by
name rather than returning `undefined`. Tier 3 (owner hand-checks) has not
run; every number above is Tier 1 + Tier 2 automated.

```bash
export PATH="$HOME/.local/bin:$PATH"   # pnpm 10 location
pnpm build && pnpm start               # real app: Discord + bolt button in user panel
pnpm start -- --ion-smoke=/tmp/ion-smoke   # headless checks, writes report.json + screenshot
```

Expected: no menu bar; bolt icon between headphone and gear icons opens the
Ion debug popover. `report.json` must show `ionShellPreload`, `coreInjected`,
`debugPanelMounted` all `true`, `webpackStatus` with
`hooked/ready/byProps/store` all `true` plus a few thousand `factories`
(`debugPanelWebpack` reads e.g. `6280 factories · finds OK`),
`pluginsStatus` with `registered: 1, started: 1, failed: 0` and
`ids: ["ion.diagnostics:started"]` (`debugPanelPlugins` reads `1/1 started`),
and the settings-UI probes `uiReady`, `ionTabMounted`, `ionPanelActive` all
`true` with `ionPanelRows > 0`, `ionPanelInScroller` showing the panel inside
the visible native scroller with Discord's own content hidden, an
`ionSelectMenu` probe (`position: fixed`, anchored to its trigger, inside the
viewport) that then closes via Escape, and `rendererErrors: []`. Two
screenshots are captured — the panel at rest and a select menu open — from a
window that never appears on screen, so the smoke run is safe while using the
computer. In the app itself, `Ctrl+Alt+J` should copy a diagnostics report to
the clipboard.

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

- **Fix the plugin store first.** Solid's `createStore` proxy silently drops
  writes, which is the largest single cause of Shelter sweep failures
  (ServerSentinel, replace-user-pfp, tarp, and three same-shaped ones).
  Upstream uses a mutable valtio proxy; the shape to match is upstream's
  `@uwu/shelter-storage`. Reproduced in a unit probe, left unfixed on purpose
  until now.
- Phase 8 remainder: Shelter stage 3 (settings sections drawn into Discord's
  settings; the two React↔Solid bridges), then re-measure the sweep — the 11
  warnings and several reads should move.
- Then: theme engine hardening, hybrid catalog browser, packaging (AppImage,
  .deb, PKGBUILD; Windows installer + portable).
- Pending decision: Linux screenshare system audio (Electron has no loopback
  on Linux) — documented workaround, owner sign-off open (Q3); also blocks
  WebScreenShareFixes.
