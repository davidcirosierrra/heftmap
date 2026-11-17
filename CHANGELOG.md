# Changelog

## 0.1.0 — first public release

### Side bar and panel

- Folders view in the side bar: size, share, weight bar and colour per item; scope by checkboxes.
- Panel with a table and a treemap, linked both ways; adjustable split; chart can be hidden.
- Zoom into a folder of the treemap: the table and the totals follow it, with a «Zoom: folder/ ✕»
  chip. Escape leaves the zoom.
- Click a legend group to highlight it and keep only its files in the table («Group: X ✕» chip).
- **Copy table** button and *Heftmap: Copy Table…* command: the rows shown, as Markdown or CSV.
- The panel comes back when the window reloads, with its sort, filter, zoom and selection.
- Keyboard: `Ctrl+Shift+Alt+H` (`Cmd+Ctrl+Shift+H` on Mac) opens the panel; `/` goes to the filter.
- «Get started with Heftmap» walkthrough in *Help: Welcome*.

### Analysis

- Usage: references between files, assets with no trace, mentioned files and entry points;
  ignore or move to the trash (with confirmation).
- The file detail says **why** a file got its usage state.
- Git: last change, uncommitted changes, age and recent-commit colours, diff.
- Hotspots: lines × how often a file changes, source code only.
- Monorepos: per-app tsconfig aliases and workspace packages, with or without `node_modules`.

### Settings

- `heftmap.language`, `heftmap.publicDir`, `heftmap.git.since`, `heftmap.usage.ignore`,
  `heftmap.usage.entryPoints`.
- `heftmap.refreshDelay` and `heftmap.autoRefresh`: when to analyze again after a change.
- `heftmap.maxTextFileSize`: text files above this size are not read.
- `heftmap.usage.weakSources`: tooling folders whose references count as mentions.
- `heftmap.exclude` and `heftmap.hotspots.exclude`: leave files out of everything, or only out of
  the hotspots.
- `heftmap.panel.defaultArea` and `heftmap.panel.defaultColor`: how a new panel opens.

### General

- English, Spanish and Basque.
- Restricted Mode support, error log with a copyable report.
- Nothing leaves your machine: no telemetry, no network requests.

Builds made before the rename were called `notime-labs.heft` with `heft.*` settings: uninstall
that one and rename any `heft.*` settings to `heftmap.*`.
