# Architecture

Monorepo layout and dependency rules are summarized in the [README](../README.md#repository-layout).
This document records design decisions as each subsystem lands.

## Injection and the shell bridge

Ion loads `https://discord.com/app` in a sandboxed, context-isolated
BrowserWindow. Core code runs in the page's **main world**, but nothing from
the shell is ever exposed wholesale to the page. The flow, in order:

1. **Preload** (`shell-desktop/src/preload`) runs before any page script, with
   `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
2. It fetches the **typed bridge** from the main process over synchronous IPC
   (`window.ionShell`, defined by `core/src/platform/shell.ts`) and exposes it
   via `contextBridge`. Core only ever talks to the shell through this object:
   settings, scoped files, `openExternal`, and the restricted `require`.
3. It fetches the **core bundle** (`packages/core/dist/index.js`, an IIFE) and
   evaluates it with `webFrame.executeJavaScript`. That is a privileged
   evaluation: it bypasses page CSP (Discord ships a nonce-based `script-src`)
   and runs before Discord's first script, so webpack module discovery can hook
   the chunk loader in time. This mirrors the proven Vesktop approach.

### IPC rules

All channels are declared in `shell-desktop/src/shared/ipc.ts` (namespaced
`ion:*`, allowlisted, unit-tested). The main process never trusts the sender:

- every handler re-checks the sender frame URL (Discord documents only),
- every payload is re-validated (shape, enum members, encoding),
- filesystem access is confined to the Ion data directory — paths are
  relative, resolved, and rejected on traversal/absolute/NUL inputs
  (`main/pathScope.ts`).

### Restricted `require`

Plugin code (notably BetterDiscord plugins) expects Node's `require`. The
preload provides an allowlisted implementation (`preload/nodeRequire.ts`):

| Module                    | Backing                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `fs`                      | synchronous IPC to main, scoped to the Ion data directory          |
| `path`                    | local reimplementation (`preload/pathApi.ts`), differential-tested |
| `electron`                | gated subset: `shell.openExternal` + `ion:*` IPC only              |
| `events`, `timers`, `url` | Electron's sandbox-safe builtins                                   |
| anything else             | throws loudly                                                      |

`nodeIntegration` stays off — Node never loads in the page; `fs` is a proxy
over IPC, not a real module.

### Debug panel

The core bundle mounts a small status widget (shadow root, Discord CSS
variables only) showing injection time, shell version, and bridge state. It is
a diagnostic: the product UI lives in `packages/ui`.
