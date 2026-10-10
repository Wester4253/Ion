# Project status

_Last updated: 2026-10-10. Phase numbers refer to the plan in `AGENTS.md`; this
file is rewritten at each phase boundary, not incrementally patched._

## Done

| Phase | Deliverable                                        | State                                                                                                         |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0     | Workspace, strict TS, lint/format/hooks, packaging | Green: clean-clone `pnpm install --frozen-lockfile` builds and tests                                          |
| 1     | Desktop shell (Electron, secure window, tray, IPC) | Live-tested on Wayland + NVIDIA: login/app loads, close-to-tray, single instance, screenshare permission path |
| 2     | Injection, typed IPC bridge, restricted `require`  | Live-tested: core runs in main world at T+~100ms, debug panel docked next to Discord's settings gear          |

Design details live in [architecture.md](./architecture.md); Linux specifics
(including the screenshare system-audio limitation) in [linux.md](./linux.md).

## How to smoke-test today

```bash
export PATH="$HOME/.local/bin:$PATH"   # pnpm 10 location
pnpm build && pnpm start               # real app: Discord + bolt button in user panel
pnpm start -- --ion-smoke=/tmp/ion-smoke   # headless checks, writes report.json + screenshot
```

Expected: no menu bar; bolt icon between headphone and gear icons opens the
Ion debug popover; `report.json` shows `ionShellPreload`, `coreInjected`,
`debugPanelMounted` all `true`.

## Next

- Phase 3: webpack module discovery (chunk-loader hook, `findByProps` and
  friends) and the source-text patch engine.
- Phase 4: core plugin host + settings store on top of the bridge.
- Pending decision: Linux screenshare system audio (Electron has no loopback
  on Linux) — documented workaround, owner sign-off open.
