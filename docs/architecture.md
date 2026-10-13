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

### Content-Security-Policy grants

Discord serves an enforced `content-security-policy` on its documents, and its
`connect-src` allowlist does not include the hosts that modded clients call.
The shell extends it from the main process — the same approach upstream
Vencord and Vesktop take (`src/main/csp`) — in
`shell-desktop/src/main/csp.ts`: `registerCspHandler` rewrites the enforced
header on main-frame responses, drops the report-only one (it would report the
violations patched plugins cause on purpose), and appends a strict allowlist.
Every grant names its consumer, so the whole set of external hosts Ion lets
Discord's document reach is reviewable in one table.

| Grant                       | Directives               | Consumer                                                       |
| --------------------------- | ------------------------ | -------------------------------------------------------------- |
| `*.vencord.dev`             | `connect-src`, `img-src` | BadgeAPI's badges and their images (upstream grants the same). |
| `raw.githubusercontent.com` | `connect-src`, `img-src` | tarp's theme list and userpfp's avatar files.                  |
| `userpfp.github.io`         | `connect-src`            | userpfp's manifest (`source/data.json`); it serves no images.  |

The last two are **a deliberate deviation from stock Discord**, which blocks
both hosts: a plugin that fetches its data from GitHub would otherwise fail
with a bare `Failed to fetch` that says nothing about why. Page-side plugins
cannot add grants themselves — the compat facades report CSP override
requests as handled by Ion — so anything missing from the table fails
visibly and is added here with its consumer named.

## Settings store and plugin host

`packages/core/src/settings.ts` persists everything to one JSON document
(`settings/core.json`) under the shell's scoped data directory: flat,
dot-separated keys; the host owns `plugins.enabled.*` and every plugin gets a
`plugin.<id>.*` namespace. Values live in memory — reads are synchronous —
writes debounce 200 ms and serialize behind each other, and a failed write
keeps the values and retries on the next change. Subscriptions fire per key.

Boot timing is the point: the shell's file bridge is synchronous IPC behind a
promise, so `await settings.load()` resolves within microtasks, before
Discord's first script runs. Plugin patches therefore register knowing the
user's persisted enabled state — the same guarantee that upstream mods get
from synchronous localStorage settings.

`packages/core/src/plugins.ts` hosts plugins whose manifest (`IonPlugin`)
mirrors Vencord's definition. The host owns patch registration on the shared
registry (attribution by plugin name, `removeByPlugin` on disable), the
start/stop lifecycle, persisted enablement, and error isolation: a plugin
that throws in `start()` is marked `failed` and logged without affecting any
other plugin. Registration is exposed as `window.__ION__.plugins`
(`register`/`list`/`setEnabled`/`status`/`subscribe`) for adapters and
catalog-installed plugins; built-ins register through
`core/src/bundledPlugins.ts` from `plugins/*` packages (type-only imports
back into `@ion/core`, so the bundle stays acyclic). Honesty note: source
patches are one-way once a module has evaluated — disabling removes remaining
patches, but `stop()` owns runtime reversion of what already applied.

## In-Discord UI (settings page)

`packages/ui` renders Ion's in-Discord UI with Preact and ships as a second
IIFE that the shell appends to the core bundle, so both evaluate in one
injection, in order, before Discord's scripts. `window.__ION__.ui.ready` flips
to `true` only after the integration actually started.

The settings page never patches Discord's React tree. Instead it keys on
Discord's own stable hooks and re-asserts its state:

- **Discovery** (`modal.ts`) is structural and localized-proof: the anchor is
  `li[data-settings-sidebar-item]:not([data-ion-tab])` (Discord's stable
  attribute; ours is excluded), sections/content/scroller/breadcrumb come
  from class-name _substrings_ (`contentBody`, `scroller`) and ancestry, and
  every function takes its `Document` as an argument.
- **The sidebar row** (`tab.ts`) clones Discord's own markup — a section
  wrapper plus one item row — replacing icon, label, ids and active state,
  then prepends it so "Ion" sits above Account with Discord's listeners and
  styling intact. The hashed active class (`active_caf372`) is captured at
  runtime from whichever row carries `aria-current`, never hardcoded.
- **The lifecycle** (`integration.ts`) observes the document (childList plus
  an `aria-current` attribute filter) and reconciles idempotently: when the
  row is selected it strips the native row's active styling, hides the
  scroller's own children (the scroller itself stays visible, so scrolling,
  the scrollbar and the column geometry remain Discord's own), swaps the
  breadcrumb text in place, and mounts the panel inside the native scroller;
  deactivation restores every hidden node's inline display verbatim. Discord
  re-renders that replace nodes, re-apply active styling, or rebuild the
  content region mid-open are re-asserted — and a rebuild while our page is
  up puts the user back on our page instead of silently reverting.
- **The panel** (`panel.tsx`) renders into a shadow root (document styles and
  user themes cannot leak in or out) with `styles.ts` reproducing Discord's
  own settings anatomy, measured from the live client: the 696px content
  column, flat sections on the modal's background, the 48×24 blurple switch,
  and borderless select triggers whose menus render at a fixed viewport
  position (re-based onto Discord's transformed modal root, which is the
  fixed-position containing block) so they never clip against the scroller.
  All color comes from Discord's current design tokens; a unit test enforces
  that only Discord's own hardcoded literals appear. It hosts the plugin
  manager (driven by `window.__ION__.plugins`), the shell settings
  (close-to-tray, tray, GPU, platform, WebRTC policy — each honestly labeled
  when a restart is required), and an About section.

Everything is dependency-injected (document, plugin API, settings API,
render callback), which is what makes the whole layer testable headlessly:
the UI's 33 unit tests run against a DOM fixture captured from the real
client, and the smoke harness tours the settings page for real (see below).

## Headless smoke harness

`--ion-smoke=<dir>` creates the main window **hidden** (and in offscreen
rendering mode, so frames still commit and `capturePage` reflects the current
DOM), opens the settings modal by clicking the gear after our debug dock,
selects the Ion tab, and reports probes: settings-structure sanity, tab/panel
presence, panel row count, that the panel lives inside the visible native
scroller with Discord's own content hidden, a settle timeline of the panel
state, renderer errors captured from the console, and a select-menu geometry
check (the open menu must be fixed-positioned, anchored to its trigger and
inside the viewport, then dismissed with Escape). It exits with
`report.json` plus two screenshots — the panel at rest and the select menu
open. This runs without ever showing a window, so it is safe on a
developer's session. Electron 44's `--ozone-platform=headless` segfaults on
this machine (a minimal app reproduces it), which is why the harness uses the
hidden-window approach instead.

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
