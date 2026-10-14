# BetterDiscord Index Compatibility Scoreboard

Measured: 216 plugins from the live BetterDiscord store
Tier 2 soak: 180 s (real Discord boot, logged out)
Run health: **unhealthy** (28 unattributed renderer errors)

**Pass:** 88
**Warnings:** 5
**Fail:** 123
**Deferred:** 0

## Root Cause Breakdown

- 52 — Logged-out (Discord modules absent)
- 32 — Other
- 15 — Validation strictness
- 14 — React/ReactDOM not loaded (logged out)
- 7 — Missing Node/zustand
- 2 — requireModule/nativeModules
- 1 — CSP grants needed (external APIs)
