# Project status

_Last updated: 2026-10-12. Phase numbers refer to the plan in `AGENTS.md`; this
file is rewritten at each phase boundary, not incrementally patched._

## Done

| Phase | Deliverable                                        | State                                                                                                                                                                    |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Workspace, strict TS, lint/format/hooks, packaging | Green: clean-clone `pnpm install --frozen-lockfile` builds and tests                                                                                                     |
| 1     | Desktop shell (Electron, secure window, tray, IPC) | Live-tested on Wayland + NVIDIA: login/app loads, close-to-tray, single instance, screenshare permission path                                                            |
| 2     | Injection, typed IPC bridge, restricted `require`  | Live-tested: core runs in main world at T+~110ms, debug panel docked next to Discord's settings gear                                                                     |
| 3     | Webpack discovery + source-text patch engine       | Live-tested: chunk hook intercepts rspack's chain, 6k+ factories wrapped, `findStore("UserStore")` and friends hit                                                       |
| 4     | Settings store + native plugin host                | Live-tested: bundled `ion.diagnostics` starts at boot (`1/1 started`), toggle/stop/patch-removal paths unit-tested                                                       |
| 5     | In-Discord UI foundation (settings page)           | Live-tested headlessly: Ion tab injected into the real settings sidebar; panel renders inside Discord's native scroller with native-matched controls (switches, selects) |
| 6     | Vencord/Equicord adapter + acceptance scoreboard   | Measured: 32/32 plugins load on a logged-out session (30 pass, 1 warnings, 0 fail, 1 deferred) through a 180s Tier 2 soak; generated `docs/compat.md`                    |

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

## How to smoke-test today

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
pnpm --filter @ion/compat-harness report    # seeds all 32, soaks 180s, rewrites docs/compat.md
```

Exit code 0 means a healthy run with no failed plugins (warnings and the
documented deferral are recorded, never hidden). Artifacts land in
`compat-runs/<timestamp>/` (gitignored); re-score an existing run with
`--report <smoke-report.json>`. Tier 3 (owner hand-checks) is the checklist in
the last column of `docs/compat.md` — nothing in that file is
Tier-3-verified.

## Next

- Phase 7: BetterDiscord adapter (BdApi implementation, BD plugin/theme
  parsing), Phase 8: Shelter adapter + bulk scoreboard — per the Q1 proposal in
  `QUESTIONS.md`.
- Then: theme engine hardening, hybrid catalog browser, packaging.
- Pending decision: Linux screenshare system audio (Electron has no loopback
  on Linux) — documented workaround, owner sign-off open (Q3); also blocks
  WebScreenShareFixes.
