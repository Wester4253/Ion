# Themes

One engine owns every theme, whichever format it arrived in. Ion's theme
engine (`packages/core/src/themes.ts`) holds the store (registration,
persisted enablement, DOM injection, change notification), the header parser
(`packages/core/src/themeHeaders.ts`), the directory sync, and the hot-reload
watcher. Adapters (`compat-bd`, `compat-vencord`) own only their directory and
the format details of reading one file; they never bundle core, so they reach
the shared engine through `window.__ION__.themeHost` — the same host global
rule as `window.__ION__.themes`.

## Where themes live and how they are found

| Source             | Directory (under Ion's data dir) | Loaded by                         |
| ------------------ | -------------------------------- | --------------------------------- |
| BetterDiscord      | `bd/themes/*.theme.css`          | `compat-bd/src/manager/themes.ts` |
| Vencord / Equicord | `vencord/themes/*.css`           | `compat-vencord/src/themes.ts`    |

Ion's data directory is private to the profile (see `docs/linux.md`); the page
never sees absolute paths, only the relative ones above, through the shell's
scoped file bridge.

Each directory is read once at boot and then watched. A change anywhere in a
watched directory is debounced (150 ms — one save is several events) and
reconciles the store: new files load, changed files are re-read in place,
deleted files are unregistered. A theme's persisted enablement
(`themes.enabled.<id>`) lives outside the store's records, so re-registering
the same id after an edit keeps the user's on/off choice.

Per-file isolation is absolute: one unreadable or unparseable file is skipped
with a one-line warning naming it, and never affects another theme. A file
that _stops_ parsing keeps its currently running theme — a half-written save
must not strip a user's theme.

## The three formats

The parser accepts all of them, in this order:

1. **Header** — a `/** … */` block whose `@name`, `@description`, `@author`,
   `@version`, `@license`, and `@source` tags describe the file. This is
   BetterDiscord's format and Vencord's is byte-compatible with it, because
   Vencord inherited it from BD. Values continue across continuation lines, a
   repeated `@author` becomes several authors, `\@` and `\n` are unescaped,
   and a leading BOM is ignored. Missing fields fall back the way BD does:
   `Unknown Author`, `???`, `No description provided`.2. **Plain CSS** — an accepted file with no header (or a header with no
   `@name`) is a theme named after its file: `Radial.theme.css` registers as
   `Radial`, with no authors and no version. Both upstream mods refuse these
   files; Ion loads them, which is why a hand-written or freshly downloaded
   stylesheet works without editing it first.
2. Everything else in the folder that does not match the adapter's admission
   rule (`*.theme.css` for BetterDiscord, `*.css` for Vencord) is not a theme
   and is ignored silently.

Themes are registered under an adapter namespace — `bd.<name>` and
`vc.<name>`, whitespace replaced — so the same file name may exist in both
directories without colliding.

## Stable CSS variables

Discord renames its own custom properties between refreshes, and the 2026
refresh removed several outright: `--background-primary`,
`--header-primary` and the whole `--interactive-*` family no longer exist, so
a theme written against them silently does nothing. Ion therefore defines its
own tokens once, in `<style data-ion-theme-base>`, before any theme style, and
documents them here. Every one resolves to the Discord token of the day with a
literal fallback, so a future rename degrades instead of breaking:

| Variable                                        | Resolves to (today)           |
| ----------------------------------------------- | ----------------------------- |
| `--ion-theme-background`                        | `--background-base-lower`     |
| `--ion-theme-background-secondary`              | `--background-base-low`       |
| `--ion-theme-background-tertiary`               | `--background-surface-high`   |
| `--ion-theme-background-raised`                 | `--background-surface-higher` |
| `--ion-theme-text`                              | `--text-default`              |
| `--ion-theme-text-strong`                       | `--text-strong`               |
| `--ion-theme-text-subtle`                       | `--text-subtle`               |
| `--ion-theme-border`                            | `--border-subtle`             |
| `--ion-theme-accent`                            | `--brand-500`                 |
| `--ion-theme-on-accent`                         | `--white-500`                 |
| `--ion-theme-radius-xs` / `-sm` / `-md` / `-lg` | Discord's radius scale        |
| `--ion-theme-space-1` … `-4`                    | 4 / 8 / 12 / 16 px            |
| `--ion-theme-font`                              | `--font-primary`              |
| `--ion-theme-shadow`                            | Ion's own elevation           |

Theme authors may rely on that table and nothing else. A theme that sets its
own value for one of these on `:root` wins, because theme styles are injected
after the base element.

## Rules for theme authors

- **Scope to Discord.** A theme is a stylesheet appended to Discord's own
  document, so a bare `body { … }` or `:root { … }` selector applies
  everywhere Ion loads — including the settings surfaces. Prefer Discord's own
  containers and the tokens above.
- **Do not use removed tokens.** `--background-primary`, `--header-primary`,
  `--interactive-normal`, `--interactive-hover` and `--interactive-active`
  no longer exist in the client. Use `--ion-theme-*` instead; they are the
  stable surface.
- **No `@import` of remote stylesheets.** Ion does not maintain a CSP
  override list (see `docs/architecture.md`), so a remote `@import` is simply
  refused. Ship the CSS in the file.
- **Say what you use.** Ion shows a theme's source and provenance before
  install and never calls a theme "safe". Themes run with the page's full
  privileges — they are code, not decoration.

## What the Vencord settings tab can and cannot do

The vendored Vencord UI reaches themes through `VencordNative.themes`, which
Ion answers from the same files: `getThemesList`, `getThemeData` and
`uploadTheme` are real (an upload writes `vencord/themes/<file>.css`, which
the watcher then registers). `deleteTheme` and `openFolder` refuse with the
exact reason: Ion's file bridge has no delete yet, and a page may not open
folders on your system. Toggling a theme in that tab writes Vencord's own
settings list, which does **not** drive Ion's theme engine — use Ion's theme
manager to enable and disable themes.
