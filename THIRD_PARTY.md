# Third-party code

Every piece of vendored or adapted code is recorded here, with its source, license, and
the files it affects. License headers are kept in the files themselves.

| Component                            | Source                                                                                                              | Upstream license                                                           | Ion files                                                                                                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vesktop (consulted)                  | https://github.com/Vencord/Vesktop @ main (2026-10)                                                                 | GPL-3.0-or-later                                                           | `packages/shell-desktop/src/main/window.ts`, `screenshare.ts`, `flags.ts`, `packages/shell-desktop/src/preload/index.ts`, `packages/shell-desktop/src/main/ipc.ts` | Studied for window close-to-tray flow, single-instance behavior, display-media handling on Linux, Chromium feature flags, and the preload injection technique (synchronous bundle fetch + `webFrame.executeJavaScript` before page scripts). Ion's implementations are original but follow the same approach; no source text copied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Vencord + Equicord (consulted)       | https://github.com/Vendicated/Vencord @ main and https://github.com/Equicord/Equicord @ main (2026-10)              | GPL-3.0-or-later                                                           | `packages/core/src/patches.ts`, `packages/core/src/lazy.ts`, `packages/core/src/webpack/*`, `packages/shell-desktop/src/main/csp.ts`                               | Studied for the patch format and its semantics (find/replacement/all/group/predicate/build windows, `\i` identifier canonicalization, consume-on-apply lifecycle), the module-discovery API surface (`findByProps`/`findByCode`/`findStore`/`waitFor` plus lazy variants and their retry behavior), the factory rebuild technique (source-text patch, eval reconstruction with a `sourceURL`), and main-process CSP extension (upstream `src/main/csp`; `csp.ts` is Ion's original, minimal equivalent with per-grant comments). Ion's implementations are original but deliberately mirror these semantics so their plugins port 1:1; no source text copied. Confirmed the two projects' `Patch` interfaces are identical.                                                                                                                                                                                                                                                                        |
| Vencord (vendored)                   | https://github.com/Vendicated/Vencord @ `16ec4ea838899706019e7f472e45f055070abeb1` (Vencord 1.15.11)                | GPL-3.0-or-later                                                           | `packages/compat-vencord/vendor/vencord/**` (320 files, including `vendor/vencord/LICENSE`)                                                                        | Verbatim copy of the import closure of `acceptance.json` plus the adapter's own imports, produced by `packages/compat-vencord/tools/vendor.mjs` and pinned per file (sha256) in `vendor/vencord/MANIFEST.json`; `tools/vendor.mjs <clone> --check` re-verifies the tree (CI runs it before every artifact build). No source adaptations. Replaced upstream modules are recorded as shims in the manifest. Upstream's license text ships with the copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| discord-types (vendored)             | `packages/discord-types` of the Vencord monorepo, same commit as above                                              | LGPL-3.0-or-later                                                          | `packages/compat-vencord/vendor/vencord/packages/discord-types/**` (including its `LICENSE`)                                                                       | Upstream consumes this workspace package via `link:`; the npm publish is stale (missing `ToastPosition`), so the workspace copy is vendored. Mostly type declarations plus the runtime `enums` bundle; LGPLv3 is GPLv3 plus additional permissions, and both license texts ship with the copy. Hashed in `MANIFEST.json` like every other vendored file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| BetterDiscord (adapted)              | https://github.com/BetterDiscord/BetterDiscord @ `133bc83b6bae998a321615a77e15b94956265d12` (1.14.2)                | Apache-2.0                                                                 | `packages/compat-bd/src/**` (50 source files)                                                                                                                      | Behavioral port of the `BdApi` surface plugins actually call: webpack discovery and its filters, the patcher (same validation order and error messages), `Data`/`DOM`/`Logger`/`Net`/`UI`/`Utils`/`ReactUtils`/`ContextMenu`/`Hooks`/`Components`, the JsonStore, the DOM manager, and plugin and theme loading — plus the addon managers behind `BdApi.Plugins` and `BdApi.Themes`. Adapted rather than copied wherever Ion's environment differs (no Node filesystem, no IPC, no second process), and every such difference is listed under "Deviations from upstream BetterDiscord" below. Upstream's own application chrome (addon list, store, modals) is deliberately not ported: it is not part of the `BdApi` surface that plugins consume.                                                                                                                                                                                                                                                |
| BetterDiscord stylesheet (vendored)  | Same commit, `src/betterdiscord/styles/{text,spinner,search,buttons}.css` and `src/betterdiscord/styles/ui/*.css`   | Apache-2.0                                                                 | `packages/compat-bd/src/api/components/styles.ts`                                                                                                                  | Verbatim, inlined as `COMPONENT_CSS` and injected once on first `BdApi.Components` access — exactly as BD injects its own core CSS. Only the files the ported components render are included; BD's application chrome styles are not, because that chrome is not ported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| lucide icon geometry (vendored)      | https://github.com/lucide-icons/lucide                                                                              | ISC                                                                        | `packages/compat-bd/src/api/components/runtime.ts` (`ICON_PATHS`)                                                                                                  | Path data for the eight icons `BdApi.Components` renders — `check`, `chevronDown`, `plus`, `minus`, `search`, `x`, `keyboard`, `pipette` — transcribed as SVG path data onto lucide's 24×24 grid and drawn with BD's stroke settings. ISC requires attribution; it is given here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| uwu/shelter (adapted)                | https://github.com/uwu/shelter @ `6d42725f7ad21df5807789e852ca8c0f8c6eb61f`                                         | CC0-1.0                                                                    | `packages/compat-shelter/src/**`                                                                                                                                   | Behavioral port of the `shelter` global a Shelter plugin's source is evaluated against: the eval contract (`shelter=>{…}` plus `//# sourceURL`), the plugin object (`onLoad`/`onUnload`/`scoped`/`store`/`startAt`), `flux` (dispatcher, store proxies, `awaitStore`, `intercept`), `patcher`, `http` (per-request cursor and `sendOnce` reuse message), `observeDom`'s reference-counted `MutationObserver`, `util`'s fiber helpers, `settings.registerSection`, `solid`/`solidH`, and `shelter.plugins`. Adapted rather than copied wherever Ion's environment differs — a host-owned plugin list, `window.__ION__.storage` instead of IndexedDB, no in-client marketplace — and every such difference is listed under "Deviations from upstream Shelter" below. Upstream's own React chrome (loader, plugin list, modal stack) is not ported: plugins never import it. Upstream ships its `LICENSE` (CC0-1.0) at the repository root; CC0's notice is given here in place of a per-file header. |
| Shelter runtime dependencies         | npm: `spitroast@2.2.0`, `solid-js@1.6.16`, `htm@3.1.1`                                                              | CC0-1.0 (spitroast), MIT (solid-js), Apache-2.0 (htm)                      | Inlined into `packages/compat-shelter/dist/*` (dependencies of `@ion/compat-shelter`)                                                                              | `spitroast` is the patcher upstream's `shelter.patcher` forwards to — same function shapes, so a plugin patching through either reads identical. `solid-js` backs `plugin.store`'s `createStore` and the `solid`, `solidStore`, `solidWeb`, and `solidH` members plugins import directly. `htm` supplies the tagged-template frontend behind `shelter.solidH.html`, bound to solid's `h`. Versions pinned by `pnpm-lock.yaml`; added with the commit that ported the Shelter adapter. Note that solid's `h` declaration imports a type from `hyper-dom-expressions`, a package solid does not depend on — that one type is declared ambiently in `packages/compat-shelter/src/hyperscript.d.ts` rather than by adding a dependency nothing bundles.                                                                                                                                                                                                                                                |
| uwu/shelter-ui (dependency)          | npm: `@uwu/shelter-ui@0.0.6` (https://github.com/uwu/shelter @ `6d42725f7ad21df5807789e852ca8c0f8c6eb61f`)          | CC0-1.0                                                                    | Inlined into `packages/compat-shelter/dist/*` (dependency of `@ion/compat-shelter`), compiled from its preserved-JSX `dist/index.jsx`                              | Shelter's own component library, published with JSX intact for its consumer to compile — which is exactly how Ion takes it, through upstream's own `babel-preset-solid` (see below) rather than a reimplementation. It backs every `shelter.ui.*` component, the `<dialog>` modal stack behind `shelter.ui.openModal` (and therefore both settings dialogs), and `ReactiveRoot`, the custom element the modals render through. CC0-1.0 is stated in the repository's `LICENSE`; the npm tarball carries no `license` field, so the repository is the authority. The published dist predates upstream's `Select`/`CheckIcon`, so those are absent — noted under "Deviations from upstream Shelter".                                                                                                                                                                                                                                                                                                 |
| Solid JSX build tooling (build only) | npm: `babel-preset-solid@1.6.16`, `@babel/preset-typescript`, `@babel/core`, `esbuild-plugin-solid@0.5.0`           | MIT (babel), ISC (esbuild-plugin-solid)                                    | `packages/compat-shelter/scripts/build.mjs` via the `solid` flag in `scripts/bundle.mjs`; `scripts/babel-presets.d.ts` declares the two untyped presets            | esbuild cannot transform Solid JSX, so `scripts/bundle.mjs`'s `solid` flag routes compat-shelter's `.tsx` and the library's `index.jsx` through `babel-preset-solid` — upstream's own pipeline, at upstream's own pins (`babel-plugin-jsx-dom-expressions@0.35.23` via `pnpm.overrides`), so a component compiles the way it does in shelter. The same presets run in `vitest.config.ts` so a settings-modal test compiles the dialog the client opens. None of it reaches the shipped bundle as tooling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| jsdom (dev only)                     | npm: `jsdom@30`                                                                                                     | MIT                                                                        | `packages/compat-shelter/src/api/{reactiveroot,settingsmodal}.test.tsx` (`// @vitest-environment jsdom`)                                                           | The mount tests need a DOM whose custom-element upgrade matches Chromium's: Chromium constructs an imported element inside `document.importNode`, which is what lets `ReactiveRoot` assign its children field after the clone is created. happy-dom upgrades on connection instead and clobbers that field, failing every modal test with `_self$.c is not a function` (verified against Electron 44 — a client-side bug would have shown there too). jsdom orders it like Chromium; `showModal` is still missing and is stubbed in the test file.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| npm runtime dependencies             | npm: `@intrnl/xxhash64@0.1.2`, `diff@9.0.0`, `fflate@0.8.3`, `gifenc@1.0.3`, `nanoid@5.1.16`, `virtual-merge@1.0.2` | MIT (xxhash64, fflate, gifenc, nanoid, virtual-merge), BSD-3-Clause (diff) | Inlined into `packages/compat-vencord/dist/*` (dependencies of `@ion/compat-vencord`)                                                                              | Required by the vendored sources and therefore bundled into the compat bundle and the Ion Index artifacts: `gifenc` encodes the GIFs FakeNitro and petpet send, `virtual-merge` merges FakeProfileThemes' option defaults, `xxhash64` hashes intl messages (`utils/intlHash.ts`), `nanoid` ids notification-log entries, `fflate` compresses cloud settings sync, `diff` renders the patch-helper's text diff. Versions pinned by `pnpm-lock.yaml`; added with the commit that translated the plugin set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Deviations from upstream BetterDiscord

Where Ion's BetterDiscord adapter deliberately differs from the Apache-2.0 code it was
adapted from. Each one is a consequence of the environment (no Node filesystem, no IPC,
a shared page) or of not silently breaking another ecosystem, never a shortcut.

**What plugins see**

- **Evaluation is deferred to the plugin's start stage.** Metadata parses when the file is
  registered; the module is evaluated and the plugin constructed when it starts. Upstream
  evaluates at load. A failure there surfaces as a plugin load failure carrying the reason
  (`failed to evaluate — …`, `constructor threw — …`) rather than a silent skip, because a
  swallowed error would report a Tier 1 pass that did not happen.
- **Display-name collisions are skipped.** Upstream has one flat namespace where a later
  addon silently wins. Ion skips the addon with a one-line reason, so a BetterDiscord plugin
  can never silently replace a Vencord plugin or another BetterDiscord plugin the user has.
- **`require()` is not Discord's Node.** `events` is satisfied page-side, in Node's CommonJS
  shape (the class _is_ `module.exports`, with Node's static self-reference) so transpiled
  `import EventEmitter from "events"` resolves. Every other id throws naming the module,
  rather than returning something partial that fails later and less clearly.
- **Addons default to enabled**, matching the host's default. Upstream keeps a persisted
  enable map that defaults to off.
- **`runAt` points map onto the host's stages** (`connection` → `webpack-ready`,
  `idle` → `dom-ready`), since BetterDiscord's connection and idle moments have no direct
  stage of their own.
- **The navigation event is observed in-page.** Upstream fires it from the main process on
  `did-navigate-in-page`; Ion watches `history.pushState`/`replaceState` and
  `popstate`/`hashchange` instead — the same moments, through one shared set of History
  hooks that uninstall with the last subscriber.
- **`BdApi.Plugins`/`BdApi.Themes` return types follow upstream's signatures**
  (`enable`/`disable`/`toggle` → synchronous boolean, `reload` → `Promise<boolean>`)
  resolved against a host whose lifecycle is asynchronous.
- **Addon identity is namespaced.** The public entry `id` is the display name, while the
  host registration uses `bd.<name>` (whitespace → `_`), so a BetterDiscord addon cannot
  collide with a native or Vencord addon in the host registry.
- **Reloading re-runs the already-evaluated module** rather than re-reading the file;
  there is no filesystem in the page.
- **`BdApi.Data` persists to DOM storage, not files.** Upstream writes one `.config.json`
  per plugin through Node's `fs`. Ion writes one storage entry per plugin, through the
  reference core captures at injection — Discord deletes `window.localStorage` from the
  window after its own scripts run, so a lazy lookup finds nothing. With no storage area
  available at all, values are held in memory and one warning states that they will not
  survive a reload.
- **`BdApi.Components` members are lazy memoized getters**, resolving on first access
  instead of at load time. `ErrorBoundary` does not carry upstream's devtools affordance,
  and `SettingGroup` and `Modal` are not ported — both depend on BetterDiscord's own
  settings store and modal stack. `Spinner` spreads its props after the size, so an
  explicit size wins.

**What the harness does**

- The acceptance set is staged sha256-pinned, so a file that moves upstream cannot
  silently change what was measured.
- Fixture plugins mirror the host's asynchronous lifecycle (`states`, `errors`), so a
  plugin that throws during start is attributed to the host's own failure record instead
  of being swallowed by the fixture.

## Deviations from upstream Shelter

Where Ion's Shelter adapter deliberately differs from the CC0-1.0 code it was adapted
from. Each one follows from the environment (a host-owned plugin list, a page with no
IndexedDB, no in-client marketplace) or from making a failure legible; none is a shortcut.

**What plugins see**

- **`onLoad` and `onUnload` are awaited, under a 30-second deadline.** Upstream fires
  `onLoad` and never waits, so a plugin whose hook never settles reads as `starting`
  forever. A hook that never finishes must not be able to score as a pass: each hook runs
  under a deadline, and the timeout is reported as that plugin's failure with the number
  of seconds in the message. A hook's returned promise is awaited too, so an async
  `onLoad` that rejects after its first `await` still fails the start instead of floating.
- **The plugin list comes from staged directories, not from shelter's index.** Upstream's
  `shelter.plugins` reads a shared index and IndexedDB. Ion reads
  `<profile>/ion/shelter/plugins/<folder>/` through the shell's file bridge. A directory
  that cannot be read, or a `plugin.json` that is not valid JSON, registers as a plugin
  that fails at start _carrying that reason_ — a broken install stays on the scoreboard
  with an explanation instead of becoming indistinguishable from one the user never added.
- **Install, edit, remove, and update throw, naming Ion's catalog.**
  `editPlugin`, `addLocalPlugin`, `addRemotePlugin`, `removePlugin`, `fetchUpdate`, and
  `updatePlugin` have no host operation behind them — installing a plugin means showing
  where its source came from, which is the catalog's job — and each throws saying so
  rather than pretending to write. `startPlugin`/`stopPlugin`/`getSettings`/`showSettingsFor`
  are wired to the host and keep upstream's exact error strings.
- **`shelter.unload` throws.** The Ion host owns plugin lifecycle, so a plugin cannot
  tear the whole loader down out from under it.
- **`plugin.store` persists to `window.__ION__.storage`, not IndexedDB.** The storage
  reference core captures at injection — Discord deletes `window.localStorage` from the
  window after its own scripts run, so a lazy lookup finds nothing. It is loaded _before_
  the source is evaluated, because plugins read it at module scope, and JSON that is not
  an object starts empty with a logged reason rather than a silent reset.
- **Log labels carry the owning plugin's name.** Upstream's `shelter.util.log` always
  prints `shelter` before the message. Here the label is the display name of the plugin
  whose code is running, so its warnings and errors land on its own row of the scoreboard
  instead of the run's unattributed bucket. The adapter's own lines use
  `[compat-shelter]`; messages printed outside any plugin keep the upstream `shelter`
  label and stay unattributed. The scope is set for module evaluation, `onLoad`,
  `onUnload`, and every callback handed to the scoped API — a callback that reaches the
  page by some other route still prints unattributed, visible rather than guessed at.
- **`shelter.util.log`'s gradient is dropped.** Upstream hands the label's gradient to
  `%c`. Chromium's captured `console-message` cannot apply a style, so it keeps the format
  specifier _and_ inlines the style into the text: every captured line came back as
  `%c[Antitrack]%c background: linear-gradient(…) …`, burying the label in what was then
  noise. The label now prints as plain text so it survives the capture — the harness
  attributes a message by its `[Name]` prefix, and the scoreboard's evidence column is only
  as readable as the line it was handed.
- **`shelter.patcher` has no `unpatchAll`.** Upstream exposes it; Ion excludes it because
  the scoped API already records and replays every unpatch a plugin is handed, and a
  global unpatch-all would reach patches owned by other plugins. The three members plugins
  actually call — `before`, `after`, `instead` — keep upstream's spitroast behaviour.
- **`shelter.patcher` callbacks keep their `this`.** The scoped wrapper is a regular
  function rather than an arrow, so a plugin that reads `this` inside a patch still sees
  the host method's receiver.
- **`shelter.settings.registerSection` accepts a section but does not draw it.** It keeps
  every section, returns an unsubscribe, and warns on _every_ registration that Ion's
  settings UI does not yet render Shelter sections. `IonUiApi` exposes only `ready`, so
  there is no registration hook to call yet; until there is, the gap says so instead of
  silently dropping the entry. (Drawing them is the follow-up, recorded in `docs/status.md`.)
- **`shelter.ui` is the library itself, minus two React↔Solid bridges.** Every export of
  `@uwu/shelter-ui` (see THIRD_PARTY.md) reaches the plugin except the four startup
  helpers upstream strips too — `cleanupCss`, `initToasts`, `injectInternalStyles`,
  `InternalStyles` — which the adapter runs itself at API build. The two bridges
  upstream merges in from its own `src/bridges.tsx`, `ReactInSolidBridge` and
  `renderSolidInReact`, need Discord's React instance and stay proxies that throw
  _their own name and reason_ on first use, so a plugin that needs one fails with
  `shelter.ui.ReactInSolidBridge is not available …` rather than
  `undefined is not a function`. They land with stage 3's settings-section work;
  the gap reports itself until then.
- **The published `@uwu/shelter-ui@0.0.6` dist is older than upstream's git HEAD.** It has
  no `Select`/`SelectOption`/`SelectItem`/`CheckIcon`, which upstream added after the
  publish. Ion ships what the package publishes, so those members are simply absent from
  `shelter.ui` (`undefined` where upstream would have a component). Revisit only if a
  top-100 plugin reaches for one.
- **`shelter.http` finds Discord's request client by shape, not by import.** Upstream
  reaches the module directly; Ion's discovery resolves `findByProps("get", "post", "put",
"patch", "del")` at API-build time. Once found, method replacement is a plain function
  swap, and upstream's per-request cursor, `sendOnce` reuse throw, and
  `"HTTP method used before API was ready"` message are reproduced.
- **The shared `MutationObserver` is created on first observation**, not when the adapter
  loads — a document observer is work, and the client only pays for it if a plugin asks.
- **Host identity is `shelter.<folder>`.** Namespacing keeps a Shelter plugin from
  colliding with a native or BetterDiscord plugin in the host registry; the display name
  comes from `plugin.json` and is what the console and the scoreboard use.

**What the harness does**

- Both staged files are pinned: `plugin.js` _and_ `plugin.json`, fetched with
  `new URL(name, base)` exactly as shelter's own updater resolves them and each verified
  against its own digest before either is written. A manifest that is not pinned could
  silently rename a plugin on the scoreboard; this way the executable and the name it is
  scored under both have to match.
- The soak window default (180s) clears `TIER2_MIN_SOAK_MS` (120s), so a default run
  measures Tier 2 rather than skipping it; a shorter `--settle-ms` is reported as
  "not run" and never claimed.
