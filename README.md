# Ion

Ion is a lightweight, Linux-first Discord client mod. It runs Discord's web client in a
hardened Electron window and loads plugins and themes from the wider modding ecosystem:
Vencord and Equicord first, then BetterDiscord, then Shelter.

Status: early development. Phases 0–4 are done: a secure Electron shell loads
Discord's official web client (tray, single-instance, persisted window state),
the core injects before Discord's scripts with webpack module discovery and a
Vencord-compatible patch engine, and the native plugin host runs bundled
plugins (`plugins/diagnostics`) against a persisted settings store. Ecosystem
plugin adapters, themes, and the catalog are not built yet.

## Goals

- Run plugins and themes from Vencord, Equicord, BetterDiscord, and Shelter, with every
  failure measured and documented in [`docs/compat.md`](docs/compat.md).
- An in-app browser for themes and plugins with provenance labels.
- Low overhead. Ion itself should stay out of Discord's way.
- Linux first (Wayland and X11), with Windows builds to follow.

## Repository layout

| Path                      | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `packages/core`           | Platform-neutral engine. Imports nothing platform-specific. |
| `packages/ui`             | In-Discord UI (Preact).                                     |
| `packages/compat-vencord` | Vencord and Equicord adapter.                               |
| `packages/compat-bd`      | BetterDiscord adapter.                                      |
| `packages/compat-shelter` | Shelter adapter.                                            |
| `packages/shell-desktop`  | Electron main and preload.                                  |
| `packages/shell-android`  | Placeholder only.                                           |
| `packages/compat-harness` | Bulk compatibility test tooling.                            |
| `plugins/`                | Built-in native Ion plugins.                                |
| `docs/`                   | Architecture, authoring guides, compat status, catalog.     |

Dependency direction is strict: shells and adapters depend on core, and core
depends on nothing but the built-in `@ion/plugin-*` packages (type-only links
back from them). ESLint enforces this.

## Requirements

- Node.js 22 (see `.nvmrc`)
- pnpm 10 (pinned in `package.json`)

## Development

```sh
pnpm install
pnpm build      # one-off build of every package
pnpm dev        # esbuild watch mode for every package
pnpm start      # run the app (build first)
pnpm typecheck
pnpm lint
pnpm test
```

### Run it

```sh
pnpm install && pnpm build
pnpm start
```

The first launch opens `https://discord.com/app` in a secure Electron window —
log in with your normal Discord account. Closing the window hides it to the
tray; quit from the tray menu. Shell settings live in
`~/.config/Ion/ion/shell.json` (see [docs/linux.md](docs/linux.md)).

Headless smoke check (loads Discord, screenshots, writes a report, exits):

```sh
pnpm start -- --ion-smoke=/tmp/ion-smoke
cat /tmp/ion-smoke/report.json
```

Git hooks are installed by `pnpm install` and run `lint-staged` on commit.

## A note on how this was built

Ion is developed with AI coding assistance, and the owner reviews and tests every change.
Treat it like any young open-source project: read the code, check the provenance of anything
you install, and report what breaks.

## A note on Discord's terms

Discord's Terms of Service prohibit modifying its client software. Ion loads Discord's
public web client into its own window and injects code into that page, which is the same
approach taken by other client mods such as Vesktop. Using Ion may violate Discord's terms
and could lead to account action. Ion does not automate accounts, and it never reads, stores,
or transmits your Discord token. You use it at your own risk.

Ion is not affiliated with or endorsed by Discord, Vencord, Equicord, BetterDiscord, Shelter,
or Vesktop.

## License

Ion is licensed under the GNU General Public License v3.0 only. See [`LICENSE`](LICENSE).
Third-party code is listed in [`THIRD_PARTY.md`](THIRD_PARTY.md).
