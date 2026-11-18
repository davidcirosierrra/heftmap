# Heftmap — what's heavy in your repo, and is it used?

Heftmap shows how much each file and folder weighs, which assets nobody references any more, and
where the big code that changes most lives. Built for web projects with heavy assets (`.glb`
models, audio, textures), useful in any git repository, including monorepos.

[Español](README.es.md) · [Euskara](README.eu.md)

![Heftmap: open the panel, Hotspots, zoom into a folder](docs/media/heftmap.gif)

## What it does

- **Folders view** in the side bar: size and share of every folder and file, with a weight bar,
  colour for the heaviest items and checkboxes to narrow the analysis to some folders.
- **Panel with a table and a treemap**, linked both ways. Every file in one sortable, filterable
  table. Treemap area by bytes, √bytes or lines; colour by extension, usage, age, recent commits
  or how often it changes.
- **Usage**: who references each file (imports, paths in strings, `url()`, `src`/`href`, Markdown
  links, `import.meta.glob`) and which assets have **no trace** at all. For those: ignore, or move
  to the trash (always asks first).
- **Git**: last commit of every file, uncommitted changes and diff.
- **Hotspots**: one button crosses lines and number of changes to find large code that keeps
  changing.

![Cursor with the Folders view and the Heftmap panel](docs/images/window.png)

![Hotspots: lines × changes](docs/images/hotspots.png)

![Usage: who references each file](docs/images/usage.png)

![Age of the last change, zoomed into a folder](docs/images/age.png)

## In the panel

- **Zoom into a folder**: click its header in the treemap. The table and the totals keep only that
  folder and a «Zoom: folder/ ✕» chip says why there are fewer rows. ✕ or Escape leaves the zoom.
- **Filter by legend group**: click a group in the legend (an extension, a usage state, an age
  band…). The treemap highlights it and the table keeps only its files, with a «Group: X ✕» chip.
  Click again or ✕ to show everything.
- **Why**: the detail of a file says which rule decided its usage state («Why: no file refers to it
  or mentions its name»).
- **Copy table**: copies the rows shown, as Markdown (for an issue or a PR) or CSV (for a
  spreadsheet). The command *Heftmap: Copy Table…* does the same; with the panel closed it copies
  the whole scope.
- **First steps**: *Help: Welcome* → «Get started with Heftmap» walks through the panel, the
  scope, files with no trace and hotspots.

## Keyboard

| Keys | Where | What |
|------|-------|------|
| `Ctrl+Shift+Alt+H` (`Cmd+Ctrl+Shift+H` on Mac) | Anywhere | Open the panel |
| `/` | Panel | Go to the filter |
| `Escape` | Panel, outside the filter | Leave the zoom |
| `↑ ↓`, `Page Up/Down`, `Home/End` | Table | Move the selection |
| `Enter` | Table | Open the selected file |
| `← →`, `Home` | Divider | Resize the table and the chart; `Home` or double click resets it |

## What it doesn't do

- It isn't a dead-code detector. For code, «No importers» is a low-confidence hint (framework
  routes, for example, are never imported). Use [Knip](https://knip.dev) for dead code.
- It never deletes anything without asking.
- It sends nothing anywhere: everything is computed locally from your files and `git`. No
  telemetry, no network requests.

## Requirements

- Cursor, VS Code 1.85 or later, or any editor that installs from Open VSX.
- `git` in the `PATH` for history and changes. Without git, Heftmap still shows sizes and usage.
- In Restricted Mode (untrusted folders) Heftmap does not run git. See [SECURITY.md](SECURITY.md).

## Settings

| Setting | Default | What for |
|---------|---------|----------|
| `heftmap.language` | `auto` | `en`, `es` or `eu`; `auto` follows the editor |
| `heftmap.publicDir` | `public` | Folder that absolute paths (`/models/x.glb`) resolve against |
| `heftmap.git.since` | empty | Limit the git history in large repos, e.g. `1.year` |
| `heftmap.usage.ignore` | `[]` | Files that never count as orphans |
| `heftmap.usage.entryPoints` | `[]` | Extra entry points (framework routes, for example) |
| `heftmap.refreshDelay` | `1500` | Milliseconds to wait after a change before analyzing again (250–60000) |
| `heftmap.autoRefresh` | `true` | Analyze again automatically when files or git change; off = only with Refresh |
| `heftmap.maxTextFileSize` | `5` | Text files above this size (MB) are not read: no lines, no usage (1–50) |
| `heftmap.usage.weakSources` | `["scripts", "tools", "bin"]` | Tooling folders: what they name counts as a mention, not as use |
| `heftmap.exclude` | `[]` | What to leave out completely, as in .gitignore (`*.snap`, `fixtures`, `docs/images`) |
| `heftmap.hotspots.exclude` | `[]` | Code left out of the hotspots, same patterns as `heftmap.exclude` |
| `heftmap.panel.defaultArea` | `bytes` | Treemap area the panel opens with: `bytes`, `balanced` or `lines` |
| `heftmap.panel.defaultColor` | `ext` | Colour the panel opens with: `ext`, `usage`, `age`, `recent` or `changes` |

## Monorepos

Each app uses its own `tsconfig.json` (aliases like `@/…`), and packages of the repo imported by
name (`@scope/pkg`) resolve to their source, with or without `node_modules`. Aliases defined only
in a bundler config (Vite, Metro, Babel) can't be followed: the log (*Output → Heftmap*) lists them,
and declaring them in a tsconfig `paths` fixes it.

## Known limits

- Every change on disk re-analyzes the repo in the background. Incremental analysis is planned.
- In a multi-root workspace only the first folder is analyzed.
- A renamed file starts counting changes from zero.

## Problems

*Output → Heftmap* has the log. If Heftmap fails it says so and offers **Copy report**: paste it into an
[issue](https://github.com/notime-labs/heftmap/issues). Security problems: see
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
