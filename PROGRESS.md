# PROGRESS

Live log for the phase-6-8 run. Updated at every commit/milestone.

- Branch: `phase-6-8` (tracks origin/phase-6-8). Base: `27851ca` (main).
- Rule: never commit/push/merge to main; no force-push; no `--no-verify`.

## Done

- Phases 0-5 committed and pushed on `main` (`27851ca` and earlier).
- Phase 6 commits on this branch (all green: typecheck, lint, 257 tests):

| Commit    | Summary                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| `3836757` | shell: `--ion-profile` isolated-run flag                                                   |
| `9105b1a` | shell: inject the optional compat-vencord bundle                                           |
| `2cda05b` | core: per-plugin patch telemetry (`window.__ION__.patches.stats()`)                        |
| `79e9e2a` | docs: plugin capability surface, phase 7/8 proposals (QUESTIONS)                           |
| `68b09fa` | shell: `scripts/smoke.mjs` isolated-profile runner                                         |
| `274b1ae` | core: dependency resolution + force-enabled required plugins                               |
| `c39d1f3` | harness: minimal CDP client                                                                |
| `fddb0b0` | core: `window.__ION__.discovery` adapter surface                                           |
| `98c023f` | core: startAt stages, enabledState seam, pre-stage patch phase                             |
| `0b1beb3` | compat-vencord: vendor closure of the 32 acceptance plugins                                |
| `16a0764` | core: upstream-parity proxyLazy (retry + same-tick destructuring)                          |
| `277252d` | core: adapter host surface (`                                                              | undefined` fields, findAll options, stage-gated late registration) |
| `d83b6f1` | compat-vencord: vendor closure extended to adapter's own imports                           |
| `34b4373` | compat-vencord: translate + bundle the 32 acceptance plugins (src, shims, build.mjs, deps) |
| `6e50310` | shell: CSP grants for *.vencord.dev (BadgeAPI)                                             |
| `49f77c7` | shell: by-design errors classified into `expectedErrors`                                   |

- Headless smoke on a fresh isolated profile is GREEN with the compat
  bundle: **33 registered (32 Vencord + ion.diagnostics), 16 started,
  0 failed, rendererErrors: []**, webpack hooked (6280 factories),
  expectedErrors = {NoTrack Sentry abort: 1}. (16 started = the host's
  required/API plugins plus upstream `enabledByDefault` plugins; upstream
  ships most plugins disabled-by-default, so Tier 1 runs must enable the
  set explicitly.)

## In progress

- Phase 6 harness work: compat-harness report.json generator + docs/compat.md
  scoreboard, Tier 1 (enable all 32, patches applied, nothing thrown) and
  Tier 2 read-only tour.

## Next (dependency order)

1. compat-harness: per-plugin Tier 1/Tier 2 runner + generated docs/compat.md
   (rendererErrors must stay empty; heavy four last, FakeNitro+FakeProfileThemes
   together).
2. Per-plugin artifact emission (esbuild) + GitHub Actions workflow for the
   Ion Index (write, cannot run here — say so in the report).
3. THIRD_PARTY.md entries (vendored 16ec4ea8 tree incl. discord-types LGPL,
   npm runtime deps); Group C plugin-vs-native decision table in docs/status.md.
4. Push milestone; then Phase 7 (BetterDiscord adapter) and Phase 8 (Shelter
   adapter + bulk scoreboard) per the Q1 proposal in QUESTIONS.md.
5. Theme engine hardening (plain CSS/BD/Vencord headers/hot reload), catalog
   browser (Ion Index + live APIs), packaging (AppImage/.deb/PKGBUILD +
   Windows installer config).

## Resume point

- Branch `phase-6-8`, tree clean and green (typecheck, lint, 257 tests,
  isolated smoke with compat bundle green as of the smoke run above).
- Next exact step: build the compat-harness report generator
  (`packages/compat-harness`) that enables all 32 translated plugins in an
  isolated profile, records Tier 1 per plugin (patches applied via
  `window.__ION__.patches.stats()`, no load/patch errors), runs the Tier 2
  read-only tour, and writes report.json + generated docs/compat.md.
