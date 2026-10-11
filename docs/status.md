# Project status

_Last updated: 2026-10-10. Phase numbers refer to the plan in `AGENTS.md`; this
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

Design details live in [architecture.md](./architecture.md); writing plugins
against the host in [plugin-authoring.md](./plugin-authoring.md); Linux
specifics (including the screenshare system-audio limitation) in
[linux.md](./linux.md).

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

## Next

- Phase 6: Vencord/Equicord adapter (starter plugin list for owner approval).
- Pending decision: Linux screenshare system audio (Electron has no loopback
  on Linux) — documented workaround, owner sign-off open.
