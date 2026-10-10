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
variables only) showing injection time, shell version, bridge state, and live
webpack-discovery status. It is a diagnostic: the product UI lives in
`packages/ui`.

## Chunk hook and module discovery

The core installs a hook on `window.webpackChunkdiscord_app` before any page
script runs. Discord ships **rspack** (not webpack proper — `bundler=rspack@1`
in its runtimes), whose setup does:

```js
(f = self.webpackChunkdiscord_app = self.webpackChunkdiscord_app || []).forEach(
  callback.bind(null, 0),
);
f.push = callback.bind(null, f.push.bind(f));
```

The runtime _reads_ `f.push`, binds it, and reassigns `f.push`; its callback
later re-invokes the captured value to pass every chunk down to the previous
chain level. A single stable function returned from a `push` getter breaks
this: the re-entry loops until the renderer OOMs (this happened during
development; the scenario is pinned by a regression test). Ion therefore
mirrors the chain — every assignment creates a fresh entry function that
wraps the incoming factories and dispatches through the newly installed
callback while freezing its own dispatch target. Each chunk passes every
runtime exactly once and terminates in a plain buffered push.

The page runs **several independent bundler runtimes** (main app, sentry,
libdiscore, fast-connect) that share the chunk global but each own a separate
`__webpack_require__` and module cache. Discovery therefore collects every
require observed in factory calls and searches all of them. Ids collide across
runtimes, so patch decisions are keyed by factory object, never by id.

`packages/core/src/webpack` exposes a Vencord-shaped API: `find`, `findAll`,
`findByProps`, `findByCode`, `findStore`, `findModuleId`, `findModuleFactory`,
`search`, `waitFor`, plus `*Lazy` variants backed by `proxyLazy` (re-evaluated
per access until the module exists). Failed finds log a warning naming the
lookup and its arguments, then return `null` — they never throw. When plugins
land, patches must be registered before Discord evaluates its modules (core
boot); late patches only ever affect factories that have not run, the same
rule upstream follows.

## Patch engine

`packages/core/src/patches.ts` is a pure engine whose format and semantics
mirror Vencord's and Equicord's public `Patch` type so their patches port
one-to-one: `find` locates the module by source, `replacement`s transform it
sequentially, `group` makes a patch all-or-nothing, `all` lets it apply to
many modules (otherwise it is consumed by the first module it patches),
`predicate` disables a patch at registration, and `fromBuild`/`toBuild` gate
on the Discord build number once one is known.

The engine cannot throw and never evaluates. The webpack runtime rebuilds a
patched factory from source text with eval (Discord's CSP ships
`unsafe-eval`; this is also how upstream mods rebuild factories) and asks the
engine to validate after every replacement, so a syntactically broken step is
attributed to the exact plugin and replacement that broke it. Any failure —
rebuild error, patched factory throwing at runtime — logs an error naming the
plugin and falls back to the original factory; the client keeps working.
`\i` identifier canonicalization is supported; `#{intl::}` expansion needs
Discord's message-hash runtime and is deferred to the Vencord compat layer.
