# PROGRESS

Live log for the phase-6-8 run. Updated at every commit/milestone.

- Branch: `phase-6-8` (tracks origin/phase-6-8). Base: `27851ca` (main).
- Rule: never commit/push/merge to main; no force-push; no `--no-verify`.

## Done

- Git setup: tree clean, main up to date, branch `phase-6-8` created and pushed.
- Phase 6 plan written (below).

## Phase 6 plan (Vencord adapter, acceptance = owner's 32 plugins)

1. Research (in parallel): map the 32 plugins' real dependencies, patches,
   aliases and load order from fresh Vencord source; map Vesktop behavior for
   the 6 web-compat plugins (plugin vs native decision).
2. Runtime foundation in `compat-vencord`:
   - Vencord-shaped module surface: `definePlugin`, `Patcher` (before/after/
     instead runtime monkeypatching — Ion core has none), webpack filters/find
     shims over `@ion/core` discovery, `@utils`/`@components` vendored where
     licenses allow (GPL-3.0, recorded in THIRD_PARTY.md).
   - Source-patch translation: Vencord `Patch[]` → Ion `PatchRegistry`
     (shapes already mirror; verify `find`/`replacement`/`predicate`/`all`
     semantics against real plugin patches, probe targets over CDP first).
3. Group A APIs (commands, context menu, message events/accessories/popover,
   chat input buttons, user settings) as vendored/reimplemented modules.
4. Group B infra (settings engine + native-scroller settings pages, notices,
   badges, dynamic image modal, concatenated component extractor, crash
   handler, support helper).
5. Group C decisions (plugin vs native shell feature) documented per plugin;
   WebScreenShareFixes = deferred, blocked on screenshare audio.
6. Group D compile pipeline: esbuild build of real Vencord plugin sources with
   Vencord's alias map, producing JS artifacts; GitHub Actions workflow for
   Ion Index (cannot be executed here — will say so).
7. Harness: per-plugin Tier 1 (load/patches/no-throw) + Tier 2 read-only tour,
   `report.json` + generated `docs/compat.md`; rendererErrors must be empty.
8. Verify heavy four last: FakeNitro + ShowHiddenChannels + Experiments +
   FakeProfileThemes (FakeNitro + FakeProfileThemes together).

## In progress

- Research phase (2 background agents).

## Resume point

- Branch `phase-6-8`, no phase-6 commits yet. Next: implement runtime
  foundation (step 2) once research reports land.
