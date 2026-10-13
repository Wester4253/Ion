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
  "shelter.replace-user-pfp":
    "Seeds its store (`store.users ??= []`) and then iterates it; Ion's plugin store drops the write, so the read is `undefined`. Known Ion defect, not an Ion API gap that this scoreboard can credit.",
  "shelter.ServerSentinel":
    "`onLoad` runs `bootstrapStore()` (`store.watchedGuilds = []` when null) and then iterates it; the write does not land in Ion's plugin store, so the read is `undefined`. Known Ion defect.",
  "shelter.tarp":
    "Its `themes.json` fetch succeeds after the `raw.githubusercontent.com` CSP grant; it then seeds `store.packs`/`store.themes` and reads them, and Ion's plugin store drops the write (`reading 'length'`). Known Ion defect.",
  "shelter.toki-pona-taso":
    "Measured only: throws reading `.toString()` of undefined during start. Nothing in the plugin's published source was isolated as the cause in this session, so no cause is claimed.",
  "shelter.dorion-notifications":
    'Measured only: throws parsing `"undefined"` as JSON during start. Not isolated against the plugin\'s source in this session, so no cause is claimed.',
  "shelter.clean-home":
    "Measured only: throws reading `.length` of undefined during start. Its store seeds itself (`Object.keys(store).length === 0` then `store[name] = true`), which matches the known store-write defect, but the throwing frame was not isolated, so no cause is credited.",
  "shelter.shelteRPC":
    "Measured only: throws reading `.length` of undefined during start. Consistent with the known store-write defect, but the throwing frame was not isolated, so no cause is credited.",
  "shelter.IntifaceWebSoundboard":
    "Measured only: throws reading `.length` of undefined during start. Consistent with the known store-write defect, but the throwing frame was not isolated, so no cause is credited.",
  "shelter.Codeblocks Plus Reloaded":
    "Loads syntax-highlighting assets from cdn.jsdelivr.net, which Discord's CSP blocks and Ion does not grant; the plugin still starts and its failure is that uncaught refusals land on its row.",
};
