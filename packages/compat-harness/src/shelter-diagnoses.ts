/**
 * One hand-written line per known Shelter index-sweep failure.
 *
 * A sweep scores the *live* catalog, so its entries are generated at run time
 * and cannot carry a `diagnosis` the way the pinned starter set in
 * `packages/compat-shelter/acceptance.json` does. These lines fill that gap:
 * each was written after reading the published `plugin.js` for a run (fetched
 * into the run's artifacts, pinned by digest, so it can be re-read), and each
 * says what is *verified from that source*. Where no line could be isolated it
 * says so instead of guessing — a diagnosis renders beside the measured
 * reason, never instead of it, so both stay visible.
 *
 * Nothing here downgrades a failure.
 */
export const SHELTER_INDEX_DIAGNOSES: Readonly<Record<string, string>> = {
  "shelter.soundboardHotkeys":
    "Calls `shelter.plugin.scoped.ui.showToast`, which upstream's `util/scopedApi.ts` never exposed — its scoped `ui` is `injectCss` only — so it fails the same way in upstream shelter; not an Ion gap.",
  "shelter.IntifaceIntegration":
    "Opens `ws://localhost:12345` for the local Intiface server — the loopback is granted in CSP, but nothing is listening on the test machine; Tier 3 with Intiface running.",
  "shelter.IntifaceWebSoundboard":
    "Same as Intiface Integration: `ws://localhost:6969` has no listener on the test machine; Tier 3 with the companion app running.",
  "shelter.orbolay":
    "Opens `ws://127.0.0.1:6888`, its default port, to the Orbolay companion app; nothing listens there on the test machine; Tier 3 with Orbolay running.",
  "shelter.Codeblocks Plus Reloaded":
    "Loads syntax-highlighting assets from cdn.jsdelivr.net; connect-src was granted after this failure (see the CSP table) and the plugin now passes.",
  "shelter.snazzy-shelter":
    "Fetches every repo in the Cumcord themes list at start — dozens of third-party github.io hosts plus raw.githubusercontent files. The manifest host was granted after this failure; every other repo host is still outside connect-src (each refusal lands, attributed, on this row) and some listed files 404 upstream. A wildcard `*.github.io` connect grant would make it pass; that breadth is an owner decision (Q9).",
  "shelter.optimizer":
    "The old-discord-font stylesheet on cdn.jsdelivr.net is refused by style-src (the `@import` originates in Revert Font's plugin.js); the style-src and font-src grants came from this failure and the plugin now passes.",
  "shelter.toki-pona-taso":
    "Loads Pyodide from cdn.jsdelivr.net — script-src, a code-execution grant deliberately left to the owner (QUESTIONS.md Q9) — and its ijo font from rawcdn.githack.com (font-src, refused as an expected error); the script refusal is what fails it.",
  "shelter.server-clock":
    "`onLoad` polls every 250 ms for the logged-in home button (`tutorialContainer`) before returning, so with no user it never settles and the host's 30 s lifecycle deadline fires; re-measure signed in.",
  "shelter.profile-theming":
    "`onLoad` waits for `UserStore.getCurrentUser()` to become non-null; it never does while logged out, so the 30 s deadline fires; re-measure signed in.",
  "shelter.noNitroUpsell":
    "`onLoad` waits for a `CONNECTION_OPEN` dispatch that never happens without a login; re-measure signed in.",
  "shelter.ContentProtectionAlways":
    "Needs `window.DiscordNative`, which Discord's web build does not define; it sets content protection through that bridge only.",
  "shelter.always-trust":
    "Patches `MaskedLinkStore.isTrustedDomain` at evaluation time; that store is not registered in the logged-out login build, so the patch target is undefined.",
  "shelter.platform-spoof":
    "Looks up Discord's `getSuperProperties` via the webpack chunk list and throws when absent; the login build does not register it.",
  "shelter.browser":
    "Calls `createChangelogButton` — a helper only shelter's own bundled loader passes to its components, not a `shelter` API — so its module cannot build outside shelter.",
  "shelter.developer-options":
    "Walks `FluxDispatcher._actionHandlers._dependencyGraph.nodes` to patch CONNECTION_OPEN handlers; on this Discord build the graph read is undefined at start (measured logged-out), so the patch aborts; Tier 3 signed-in to tell a login-build difference from a refactor.",
  "shelter.dorion-notifications":
    "Runs only inside the Dorion (Tauri) desktop app: its config `invoke` bridge (`window.__TAURI__`/`window.Flooed`) does not exist in a browser, so the config parses as undefined; not an Ion gap.",
  "shelter.dorion-settings":
    "Top-level init awaits `window.__TAURI__.core.invoke` (Tauri IPC); nothing defines `__TAURI__` in a browser, so section registration rejects — a Dorion-app-only plugin, not an Ion gap.",
  "shelter.dorion-updater":
    '`JSON.parse(await invoke("read_config_file"))` — the Tauri IPC is absent outside the Dorion app, so the config comes back undefined; Dorion-app-only.',
};
