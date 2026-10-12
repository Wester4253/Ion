# Plugin authoring

Ion's native plugin format mirrors Vencord's plugin definition so existing
plugins port mechanically: the same identity fields, the same `start`/`stop`
lifecycle, the same patch format. This document covers the native host; the
Vencord/Equicord/BetterDiscord/Shelter adapters translate their formats into
this one.

## The manifest

A plugin is a plain object typed `IonPlugin` (exported from `@ion/core`):

```ts
import type { IonPlugin } from "@ion/core";

const myPlugin: IonPlugin = {
  // Stable unique id — also the settings namespace. A token, no whitespace.
  id: "example.hello",
  // Display name — must be unique; patch notices are attributed by it.
  name: "Hello",
  description: "Does something useful.",
  authors: [{ name: "Ada", id: "ada" }],
  version: "1.0.0",
  // Enabled unless the user disabled it. Defaults to true.
  defaultEnabled: true,

  // Source patches, registered with the engine before Discord evaluates
  // its modules (same format as Vencord's `Patch`, minus `plugin` — the
  // host injects the attribution).
  patches: [
    {
      find: "SomeModule",
      replacement: [{ match: /\i\.someMethod\(/, replace: (m) => `${m}/* hello */` }],
    },
  ],

  start(context) {
    context.log.info("running");
    const level: number = context.settings.get("level", 3);
    context.settings.set("level", level);
    context.settings.subscribe((key, value) => context.log.info(key, value));
  },

  stop(context) {
    // Undo runtime effects: listeners, timers, observers, patches you
    // applied yourself. Symmetric start/stop is what makes toggling safe.
    context.log.info("stopping");
  },
};

export default myPlugin;
```

`context` gives you two things:

| Member             | What it is                                                         |
| ------------------ | ------------------------------------------------------------------ |
| `context.settings` | get/set/delete/subscribe, scoped under `plugin.<id>.*`             |
| `context.log`      | `info/warn/error`, prefixed `[ion] [<name>]` — the only print path |

The webpack discovery API (`find`, `findByProps`, `findStore`, `waitFor`,
`registerPatches`, …) is importable from `@ion/core` inside bundled plugins
and is the same surface Vencord plugins are written against.

## Where plugins live

- **Built-in** plugins are packages under `plugins/*` (e.g.
  `plugins/diagnostics`) whose source is bundled into the core; one line in
  `packages/core/src/bundledPlugins.ts` registers each one.
- **Runtime-registered** plugins (the catalog path, and every compat adapter)
  call `window.__ION__.plugins.register(plugin)` in page context. Registration
  before core boot is impossible for those — they start as soon as they are
  registered if enabled.

## Lifecycle and timing

1. Core evaluates: the chunk hook installs, settings load (the shell's file
   bridge is synchronous IPC behind a promise, so this finishes in microtasks
   — **before Discord's first script**), bundled plugins register, enabled
   plugins start.
2. `start()` runs once the plugin is enabled; `stop()` runs when it is
   disabled (via `window.__ION__.plugins.setEnabled`, later the plugin
   manager UI). Toggling back on re-registers patches and starts again.
3. A `start()` that throws (or rejects) marks the plugin `failed`, logs the
   error, and never affects other plugins — the rest keep booting. The patch
   set it declared stays registered until it is disabled; retrying with
   `setEnabled(id, true)` re-registers without duplicating.

Rules the host enforces, and the honest limits:

- **Patches are one-way after evaluation.** A patch registered before a
  Discord module evaluates modifies it. Disabling removes the plugin's
  remaining patches from the registry, but modules already patched keep the
  change — `stop()` owns any runtime reversion (the same limitation upstream
  has). Registering late (runtime registration) only ever affects modules
  that have not evaluated yet.
- **Ids and names are unique**; registration throws otherwise.
- **Settings must be JSON-serializable**; whitespace keys are rejected; type
  mismatches against the default fall back to the default with a logged
  warning.

## Plugin capability surface (what plugin code can reach)

Plugins run in Discord's page main world with **no Node, no
`ipcRenderer`** — `nodeIntegration` stays off and the shell never exposes
its bridge to the page. Everything a plugin can use is one of:

| Capability           | Surface                                                                               | Bounds                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord's page       | DOM, `window`, Discord's own modules                                                  | Whatever the page already has. No token is ever read, logged, stored, or transmitted by Ion's APIs or shims.                                                                                                                                                                                   |
| Module discovery     | `find`/`findByProps`/`findByCode`/`findStore`/`waitFor` + lazy variants (`@ion/core`) | Read-only lookups over Discord's webpack caches; misses log a warning and return null.                                                                                                                                                                                                         |
| Source patches       | `patches` in the manifest, registered by the host before Discord evaluates            | Applied only to factories that have not run yet; attributed per plugin; failure is a notice, never a crash.                                                                                                                                                                                    |
| Scoped settings      | `context.settings` (`get/set/delete/subscribe`)                                       | Persisted under `plugin.<id>.*` in Ion's data directory; JSON-serializable values only.                                                                                                                                                                                                        |
| Scoped files         | `window.ionShell.files` — **only** through the restricted `require("fs")`             | Every path is confined to the Ion data directory; `..` and absolute paths are refused by the shell (double-checked over IPC).                                                                                                                                                                  |
| Restricted `require` | `require(id)` for `fs`, `path`, `electron`, `events`, `timers`, `url`                 | Allowlist only — anything else throws. `electron` is a gated subset: `shell.openExternal` (URL allowlist enforced by the main process) and `ipcRenderer.sendSync/invoke/on` filtered to Ion's own channels twice (preload and main). No raw `ipcRenderer`, no `remote`, no arbitrary channels. |
| External links       | `window.ionShell.openExternal(url)`                                                   | Scheme allowlist enforced by the main process.                                                                                                                                                                                                                                                 |

This is deliberately the **BetterDiscord-level model** (per AGENTS.md): plugin
computer access comes from a preload bridge allowlist, not from Electron's
sandbox being disabled. Expanding this surface — new `require` modules, new
IPC channels, broader file access — is a decision that needs owner sign-off,
not an implementation detail.

Honest framing for users: this boundary makes what a plugin _can_ reach
narrow and reviewable; it does not make any specific plugin "safe". Ion shows
source and provenance before install and never auto-updates plugins
silently.

## Settings storage

Everything persists to `settings/core.json` in the Ion data directory through
the shell's scoped file API: flat dot-separated keys, writes debounced 200 ms
and serialized, values always readable synchronously from memory after boot.
The host owns `plugins.enabled.<id>`; your namespace is `plugin.<id>.*`.

## Example

`plugins/diagnostics` is the reference built-in: a configurable keyboard
shortcut, a settings subscription surface, symmetric start/stop, and report
generation through `window.__ION__`.
