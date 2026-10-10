Project

Ion is a lightweight, Linux-first Discord client mod. Its defining features:

    It runs plugins and themes from the other major mods: Vencord and Equicord first, then BetterDiscord, then Shelter, then others if realistic. The goal is for all plugins from those sources to work, measured honestly, with the failures listed.

    An in-app browser for themes and plugins. A unified catalog fetching from multiple sources.

    Lightweight, with low overhead from Ion itself.

Coverage target: about 99% of the popular plugins in each supported ecosystem actually working, measured with the tiers defined below. The owner cares about this more than almost anything else.

Quality Target: Ion is being built as a daily driver for the owner and their friends. It must be production-grade, highly polished, and extremely stable. Do not write "AI slop"—every line of code must be deliberate, clean, and optimized. The final output must feel hand-crafted by an expert engineer, and the UI must be indistinguishable from native Discord.

An Android app may come later, so the core must not be tied to the desktop shell. No Android work now.
Tech stack (decided)

    TypeScript (strict mode) everywhere

    Electron for the desktop shell, with contextIsolation: true, nodeIntegration: false, sandbox: true where possible. The shell sits behind an interface so core never imports Electron.

    Preact for Ion's in-Discord UI. Ion's UI styles must be isolated (e.g., Shadow DOM or scoped CSS) to prevent user themes from breaking Ion. Crucially: The UI must perfectly mimic Discord's native design language (using Discord's native CSS variables for colors, fonts, spacing, and animations).

    pnpm workspaces; esbuild for bundling; electron-builder for packaging

    Vitest for unit tests; Playwright (Electron mode) for smoke tests

    ESLint + Prettier, with a pre-commit hook

    License: GPL-3.0.

Targets

    Linux first (Wayland and X11, PipeWire screenshare with audio, sensible GPU and Ozone/Chromium flag handling exposed as settings). Packages: AppImage, .deb, and a PKGBUILD for Arch-based distros.

    Windows also supported (installer plus portable if easy). The agent cannot test Windows, so for anything Windows-specific it must say so and provide a manual test checklist.

    No macOS for now.

Architecture

Monorepo packages. The dependency direction is strict: adapters and shells depend on core; core depends on nothing platform-specific.
code Code

ion/
packages/
core/ Platform-neutral: webpack module discovery, patch engine, native plugin host,
settings store, theme engine, catalog client, logging.
ui/ In-Discord UI (Preact): settings, plugin manager, theme/plugin browser.
compat-vencord/ Vencord and Equicord adapter.
compat-bd/ BetterDiscord adapter: BdApi implementation, BD plugin/theme parsing.
compat-shelter/ Shelter adapter.
shell-desktop/ Electron main and preload: window, tray, IPC, updater, packaging.
shell-android/ Placeholder only. No work now.
compat-harness/ Test tooling that bulk-loads plugins and produces the compat report.
plugins/ Built-in native Ion plugins.
docs/ Architecture, plugin authoring, compat status (generated), catalog format.

Key mechanisms:

    Injection: the shell's preload script runs before Discord's scripts and loads the core bundle into the page.

    Module discovery: hook the webpack chunk loader; expose findByProps, findByCode, findStore style lookups plus lazy variants for modules that load late.

    Patching: source-text patches applied to module code before evaluation. Ion's native patch format and plugin manifest must deliberately mirror Vencord's. Read Vencord's and Equicord's public source to learn the exact semantics. A failed find logs a warning naming the plugin and patch, and never crashes the client.

    Adapters: each implements a common PluginFormatAdapter interface and translates a foreign format into the core host's lifecycle.

    Themes: one theme engine that understands plain CSS, BetterDiscord theme headers, and Vencord-style theme headers, with hot reload and a documented set of stable CSS variables.

    Catalog layer: A hybrid in-app browser for themes and plugins. It pulls from the Ion Index (a curated, hash-verified GitHub list, primarily for CI-compiled Vencord/Equicord plugins) AND directly queries live official APIs (like BetterDiscord and Shelter's public lists) to allow full browsing and one-click installs of all available mods.

    Vencord Plugin Compilation: Vencord plugins are TypeScript and require compilation. We handle this via Cloud Compilation: GitHub Actions in the Ion repo will fetch, compile, and publish JavaScript artifacts to the Ion Index. The app itself just downloads the finished JS file.

Compatibility testing rule

Compatibility is defined by real plugins, never by claims. Two stages per ecosystem:

    Starter set: propose 5 to 10 popular real plugins and wait for the owner to approve or edit the list. Use it to get the adapter working early.

    Bulk harness: write a script in compat-harness that loads every plugin available from that source (inside a real running Ion/Discord page where possible) and records, per plugin: loaded OK, loaded with warnings, crashed on load, patches that failed to apply, and missing APIs it needed. Output a generated docs/compat.md scoreboard.

100% is unlikely. The goal is maximum coverage with every failure explained.
Coverage target and tiers

The target is about 99% of the popular plugins per ecosystem. Measure it honestly, in three tiers:

    Tier 1, loads cleanly (automated): the plugin loads, all of its patches apply, and nothing throws at load.

    Tier 2, survives a UI tour (automated): with the plugin enabled, a scripted tour runs for several minutes with no uncaught errors or failed patches attributable to the plugin. The tour must be read-only.

    Tier 3, verified by hand (the owner): the owner confirms the plugin's actual feature works, for the top 50 plugins per ecosystem.

"Popular" means the top 100 per ecosystem. The target is 99% of that set at Tier 2. Exclusions are allowed only for: mobile-only, malware, dead services, or discontinued mods outside supported ecosystems.
Hard rules (never violate)

    No AI Slop. Code must be modular, heavily typed, and DRY. No giant unreadable files. No swallowing errors with empty catch blocks. No leaving dead code, placeholder TODOs, or lingering console.log statements. If a feature takes extra time to write cleanly, take the time.

    Native Polish. The UI must never look like a generic Bootstrap/Tailwind web page. It must perfectly integrate into Discord's visual hierarchy.

    Ion's own APIs and all compatibility shims must never intentionally expose, log, store, or transmit the user's Discord auth token.

    Plugin access to the computer follows BetterDiscord's model via a Preload Bridge. Discord's native sandbox (nodeIntegration: false) stays ON. Instead, the preload script creates a controlled, allowlisted require bridge passed exclusively to the Ion plugin engine.

    Be honest about sandboxing. Show source and provenance before install, never auto-update plugins silently, and never describe plugins as "safe".

    No telemetry, analytics, or phone-home behavior. Ion's only own network calls are the update check and catalog fetches.

    No selfbot or account automation features in Ion itself.

    Code reuse is allowed (the project is GPL-3.0) from GPL-compatible sources such as Vencord and Equicord, but: check each project's license first, keep license headers and attribution, record every piece of vendored or adapted code in THIRD_PARTY.md. Never vendor Discord's own code or assets.

    The IPC bridge must be allowlisted and typed. Never expose ipcRenderer or Node APIs directly to the page.

    Do not add dependencies casually. Justify each new one in the commit message.

Workflow rules

    Small, reviewable steps. One logical change per commit, with conventional commit messages.

    Before each phase, state a short plan. After each, summarize changes and give a "How to test this right now" section with exact commands and what the owner should see.

    Run typecheck, lint, and tests before saying anything is done. If something can't be tested in this environment, say so instead of claiming it works.

    Keep docs/ current.

    Keep core free of Electron and Node-specific imports. If a platform capability is needed, define an interface in core and implement it in the shell.
