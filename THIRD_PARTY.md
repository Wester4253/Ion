# Third-party code

Every piece of vendored or adapted code is recorded here, with its source, license, and
the files it affects. License headers are kept in the files themselves.

| Component           | Source                                              | Upstream license | Ion files                                                                 | Notes                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------- | ---------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vesktop (consulted) | https://github.com/Vencord/Vesktop @ main (2026-10) | GPL-3.0-or-later | `packages/shell-desktop/src/main/window.ts`, `screenshare.ts`, `flags.ts` | Studied for window close-to-tray flow, single-instance behavior, display-media handling on Linux, and Chromium feature flags. Ion's implementations are original but follow the same approach; no source text copied. |
