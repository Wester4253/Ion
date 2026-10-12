# Questions for the owner

Format: question, why it matters, options, recommended default. Work continues
on everything unblocked; only truly blocking items stop the run.

## Q1: Phases 7 and 8 are not defined in docs

- **Question**: `docs/status.md` and `docs/architecture.md` do not define
  Phases 7 or 8 (status.md only lists "Next: Phase 6"). What should 7 and 8
  cover?
- **Why it matters**: your run-mode instructions say to read their definitions
  from those docs and not invent scope if unclear.
- **Options**:
  1. (a) Proposed: Phase 7 = BetterDiscord adapter (`compat-bd`: BdApi,
     plugin/theme parsing); Phase 8 = Shelter adapter (`compat-shelter`) +
     bulk compat harness + generated `docs/compat.md` scoreboard.
  2. (b) Phase 7 = catalog layer (in-app browser, Ion Index, cloud compile
     workflow); Phase 8 = BetterDiscord adapter.
  3. (c) Something else you have in mind.
- **Recommended default**: (a), matching the ecosystem priority order in
  AGENTS.md (Vencord first, then BetterDiscord, then Shelter).
- **Status**: writing proposed definitions in docs/status.md at the phase-6
  boundary; continuing with Phase 6 meanwhile.

## Q2: How to verify Vencord plugin behavior without touching your session

- **Question**: Tier 2 verification needs a logged-in Discord (message
  rendering, context menus in channels). Run mode forbids using your real
  Discord login/session. Options for the smoke/tour profile?
- **Why it matters**: most of the 32 plugins only exercise their code on a
  logged-in app; on the login screen the tour can only reach plugin load +
  patch application (Tier 1), not message-level behavior.
- **Options**:
  1. (a) Fresh isolated `user-data-dir` per run, unauthenticated: verify
     Tier 1 fully + Tier 2 for everything reachable pre-login (settings UI,
     context menus, webpack probes); mark message-dependent checks
     "deferred — needs session" and list them for your Tier 3 pass.
  2. (b) You provide a dedicated throwaway/test account credentials for CI
     use (requires your explicit approval per run-mode rules — asking here).
  3. (c) Reuse your existing Ion profile read-only (violates the isolation
     rule — not proposed).
- **Recommended default**: (a) now, since it keeps everything unblocked and
  touches nothing of yours; the scoreboard will show exactly which checks are
  deferred pending your Tier 3 pass or a test account.
- **Status**: open, but not blocking — proceeding with (a).

## Q3: WebScreenShareFixes

- Per your instruction: **deferred, blocked on screenshare audio** (Linux
  PipeWire system-audio screenshare). Not guessed at, not partially
  implemented; recorded as `deferred` in the scoreboard.
