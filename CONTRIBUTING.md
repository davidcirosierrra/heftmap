# Contributing to Heftmap

Thanks for your interest in Heftmap! Bug reports, ideas, translations and pull requests are all
welcome. This guide explains how to get the project running and what a good contribution looks
like. For what Heftmap does, see the [README](README.md).

> **Language.** Issues and pull requests can be written in English or Spanish (Basque is fine too).
> The code comments and the internal design docs in `docs/` are in Spanish; you don't need to
> write Spanish to contribute.

## Ways to help

- **Report a bug.** Open an [issue](https://github.com/notime-labs/heftmap/issues). If Heftmap
  showed an error, use **Copy report** and paste it; otherwise include the Heftmap version, your
  editor (Cursor or VS Code and its version), your OS and, if you can, a small repository that
  reproduces the problem. *Output → Heftmap* has the log.
- **Security problems:** please don't open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Suggest a feature.** Open an issue first and describe the problem you want to solve. Heftmap
  tries to stay small and focused (see [Principles](#principles)), so it's worth agreeing on the
  idea before writing code.
- **Improve a translation.** The interface is in English, Spanish and Basque. See
  [Translations](#translations).
- **Send a pull request.** Small fixes can go straight to a PR; bigger changes, please open an
  issue first.

## Getting started

Requirements: Node.js 20 or later (CI uses 22), `git` in the `PATH`, and Cursor or VS Code 1.85+.

```bash
git clone https://github.com/notime-labs/heftmap.git
cd heftmap
npm ci
npm test
```

### Run the extension from source

1. Open the folder in Cursor or VS Code.
2. Press **F5** (*Run and Debug* → **Heftmap: probar la extensión**). The pre-launch task builds
   `dist/`.
3. An *Extension Development Host* window opens with Heftmap loaded from your code. Open any
   project there to analyze it.
4. After a change, run `npm run build:ext` and reload the test window (*Developer: Reload
   Window*). `npm run watch:ext` rebuilds the extension host on save; changes to the worker or the
   panel still need `npm run build:ext`.

If F5 does nothing, run `npm run build:ext` and check that `dist/extension.cjs`, `dist/worker.cjs`
and `dist/webview.js` exist. More detail (in Spanish) in
[docs/prepareextension.md](docs/prepareextension.md).

### Install a local build

```bash
npm run package                       # builds heftmap.vsix
cursor --install-extension heftmap.vsix   # or: code --install-extension heftmap.vsix
```

A `.vsix` installed by hand doesn't update itself; uninstall it to go back to the Marketplace /
Open VSX version.

### CLI

The analysis core also runs as a CLI, handy for debugging without the editor (its report is in
Spanish):

```bash
npm run build
node dist/cli.js /path/to/repo            # readable report
node dist/cli.js /path/to/repo --json     # full index as JSON
node dist/cli.js /path/to/repo --since 1.year
```

## Before you open a pull request

Run the same checks as CI:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run package     # the .vsix must build
```

And please:

- Branch from `main` and keep each PR to one topic. `main` is protected: every change goes through
  a PR and CI must be green.
- **Add or update tests.** Pure logic has unit tests; the panel is tested with jsdom
  (`test/webview-*.test.ts`) and the extension with a fake `vscode` API
  (`test/fake-vscode.ts`).
- **Update [CHANGELOG.md](CHANGELOG.md)** under an `## Unreleased` heading (create it if needed)
  for any change users will notice.
- For UI changes, attach a screenshot or a short GIF to the PR.
- If you add or change a **setting**, update `package.json` (`contributes.configuration`),
  `src/extension/settings.ts`, the three `package.nls*.json` files and the settings table in the
  three READMEs.
- Don't bump the version: releases are done by the maintainer.

## Principles

These come from the README and from past security reviews. PRs that break them are unlikely to be
merged:

- **Local only.** No telemetry, no network requests. Everything comes from the files and `git`.
- **Never delete without asking.** Destructive actions always confirm, and go to the trash.
- **The analyzed folder is untrusted input.** It must never be able to run code, read or write
  outside itself, hang the editor or make the panel act on its own. Watch out for paths, globs
  (ReDoS) and how `git` is invoked. In Restricted Mode Heftmap doesn't run `git`. Threat model in
  [docs/seguridad.md](docs/seguridad.md).
- **Light on resources.** The analysis runs in a worker, off the extension host. Memory use must
  stay modest even on large monorepos: hundreds of MB is not acceptable.
- **Honest about confidence.** Heftmap is not a dead-code detector; usage states for code are
  hints and the UI says why a file got its state.

## Translations

All three languages must stay complete; CI fails otherwise.

- **Interface texts:** `src/i18n/messages.ts`. `en` defines the keys; `es` and `eu` share its type,
  so a missing or extra key doesn't compile. `test/i18n.test.ts` also checks that placeholders
  (`{n}`, `{path}`) match and that plurals come in `.one` / `.other` pairs.
- **Manifest texts** (commands, settings, walkthrough): `package.nls.json`, `package.nls.es.json`,
  `package.nls.eu.json`.
- **READMEs:** [README.md](README.md) (English, shown in the stores), [README.es.md](README.es.md)
  and [README.eu.md](README.eu.md).
- Fixed terms per language are in [docs/glosario.md](docs/glosario.md).

If you only speak one or two of the languages, add the texts you can and say so in the PR; the
maintainer will fill in the rest.

## Project layout

```
src/
  cli.ts, report.ts   CLI and its report
  core/               analysis core, no dependency on vscode
  extension/          the extension (vscode host + worker)
  webview/            the panel (React, browser bundle)
  i18n/               texts and formats in en / es / eu
test/                 vitest
docs/                 design and internal notes (Spanish)
```

- **`src/core/`** — the analysis, usable from the extension, the worker and the CLI.
  `files.ts` lists files (git-tracked plus untracked, non-ignored), `git.ts` reads history (and
  finds the `git` executable safely), `classify.ts` and `types.ts` decide each file's kind,
  `glob.ts` handles globs, `workspace.ts` discovers the repo's own packages (monorepos) and
  `limits.ts` gathers the fixed limits. Usage lives in `usage/`: `extract.ts` (per-language
  extractors; TypeScript is used at runtime as the parser), `resolve.ts` (paths, tsconfig, aliases,
  globs) and `index.ts` (`analyzeUsage`).
- **`src/extension/`** — `extension.ts` is the `vscode` layer (commands, scope, status bar).
  `analysis.ts` drives the analysis cycle (schedule, cancel, progress, file watching); `runner.ts`
  starts the worker and `worker.ts` runs the core (separate bundle, `dist/worker.cjs`).
  `settings.ts` is the only place that reads `heftmap.*` settings. `folders-view.ts` is the
  *Folders* view, with `bars.ts` (text weight bars) and `decorations.ts` (colours).
  `panel.ts` creates the webview, `panel-protocol.ts` defines its messages and `panel-data.ts`
  turns the core index into what the panel receives. `scope.ts` and `tree-model.ts` are pure
  logic. `log.ts` is *Output → Heftmap*.
- **`src/webview/`** — `App.tsx` composes the panel from `Table.tsx`, `Treemap.tsx` and
  `Detail.tsx`. Pure, tested logic: `model.ts` (rows, filter, sort), `treemap-layout.ts`,
  `colors.ts`. `columns.tsx` defines the table columns, `saved.ts` the persisted state
  (`useSaved`), `split.ts` the resizable divider and `errors.tsx` the error screen.
- **`src/i18n/`** — dictionaries (`messages.ts`), analysis warnings and number/size/date
  formats, shared by the extension, the panel and the CLI.

The full design is in [docs/SPEC.md](docs/SPEC.md) (Spanish), including the plan for incremental
analysis, the next big piece of work.

## Releases

Releases are made by the maintainer and published to Open VSX and the Visual Studio Marketplace.
The process is documented in [docs/publicar.md](docs/publicar.md) (Spanish).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
