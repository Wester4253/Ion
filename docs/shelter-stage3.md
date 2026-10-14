# Shelter stage 3 — settings sections drawn into Discord's settings

_Last updated: 2026-10-13._

Stage 3 is the last API gap in the Shelter adapter: `shelter.settings.registerSection`
now _draws_ the section into Discord's own user settings, and the two React↔Solid
bridges (`shelter.ui.ReactInSolidBridge`, `shelter.ui.renderSolidInReact`) are
implemented instead of placeholders.

## What is implemented

| Piece               | File                    | What it does                                                                                          |
| ------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Section registry    | `api/settings.ts`       | Accepts descriptors, deduplicates by id (re-registering an id replaces the row), draws, unsubscribes. |
| Layout drawing      | `api/settingsLayout.ts` | Turns descriptors into Discord layout nodes and injects them into the settings layout tree.           |
| Fiber walking       | `api/fiber.ts`          | Port of upstream's `getFiber`/`reactFiberWalker`, used to force a redraw of an already-open modal.    |
| React↔Solid bridges | `api/bridges.tsx`       | Port of upstream's `src/bridges.tsx`; renders a plugin's Solid section through Discord's React.       |

Mechanisms, both upstream's (`uwu/shelter`, CC0-1.0 — see `THIRD_PARTY.md`):

- **The layout tree** is reached through a getter installed on
  `Object.prototype.buildLayout` _before_ Discord builds its settings tree. Discord's
  layout nodes build themselves through that prototype accessor, so the getter is
  handed the root on its first build, and the nodes it produces are patched in then.
  The `set` handler copies the value onto the instance, so every other writer on the
  page (Discord, other mods) is unaffected. The getter is installed only while at
  least one section is drawn and deleted when the last one goes.
- **An open modal** is redrawn by walking React's fiber tree from a settings sidebar
  item to the modal's state and dispatching a copy of the same `Set` back — the
  trick upstream's `rerenderSettings` uses, because that state has no public handle.
- **Node types** are stolen from Discord's own `language_and_time_panel` subtree so a
  build that renumbers them is followed automatically; upstream's default numbers are
  the fallback, announced once per session at adapter level when the steal misses.
- **Section components** render through `renderSolidInReact`, so a plugin's Solid
  panel lives inside Discord's React tree — portals, context and patches compose
  instead of forking a second React.

A session where module discovery resolved no Discord React instance cannot render a
section at all; `registerSection` then reports that to the registering plugin under
its own log scope (`settings sections are accepted but could not be drawn …`) instead
of leaving an empty sidebar unexplained. `shelter.ui`'s two bridges fail the same way
by name.

## What is verified here (Tier 1 + Tier 2, automated)

- `api/bridges.test.tsx` — both bridges against a stand-in for React: what they hand
  React, where they mount, unmount, and how a prop update crosses the boundary in
  each direction.
- `api/settingsLayout.test.ts` — the built tree: one group per `["header"]`, rows
  nested group → sidebar item → panel → category → setting (the chain Discord's
  renderer dispatches on), the prototype hook installed while sections exist and
  removed when the last one goes, and the no-React path drawing nothing while saying
  so.
- `api/scoped.test.ts` — the registry under a plugin's scope: dedupe by id,
  unsubscribe, and that a "could not draw" report is attributed to the plugin that
  registered the section.
- The live index sweep ([compat-shelter-index.md](./compat-shelter-index.md)) — the
  eleven settings warnings before stage 3 were this gap reporting itself; the sweep
  after stage 3 is the measurement of whether they moved.

## What is NOT verified here

**No test in this repository opens Discord's settings modal.** That requires a
signed-in session, which this environment does not have. Nothing below is claimed
working until the owner's Tier 3 pass says so:

- That Discord's layout renderer accepts the injected nodes on the current build
  (the stolen type numbers, the `games_and_apps_section` anchor).
- That an already-open settings modal redraws (the fiber walk and `Set` dispatch).
- That a plugin's Solid panel actually appears, sizes correctly, and survives
  navigating between tabs.

### Tier 3 checklist (owner, signed in)

For each of these plugins — the six that registered settings sections in the last
sweep — enable it, open **User Settings**, and confirm the row exists and its panel
renders:

1. Dorion Theme Browser
2. Inline CSS
3. Plugin Browser
4. Snazzy Shelter
5. ServerSentinel
6. Leaver

plus any plugin whose row appears in a later sweep with a settings warning.

For each: row visible in the sidebar under its header · panel renders (not blank) ·
search for the row name in settings search finds it · navigating away and back keeps
it · unregistering (disabling the plugin) removes the row · no console errors while
the settings modal is open.

Also check once, with **no** Shelter plugin enabled: `Object.prototype.buildLayout`
is absent (`Object.getOwnPropertyDescriptor(Object.prototype, "buildLayout")` is
`undefined`) — stage 3 must leave Discord untouched when nothing is drawn.

## Failure modes to expect

| Symptom                                                                              | Where it is said                                                                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `settings sections are accepted but could not be drawn: … no Discord React instance` | Adapter log, under the registering plugin's scope; discovery could not resolve React.                                                   |
| `shelter.ui.<member> needs Discord's React instance …`                               | Thrown by the bridge a plugin called, naming itself.                                                                                    |
| `Discord's settings layout templates could not be found …`                           | Adapter log, once per session; rows still draw with upstream's default node types.                                                      |
| Rows missing until the modal is reopened                                             | The layout hook patches the tree on build; a modal opened before the first registration needs the redraw path — report it, it is a bug. |
