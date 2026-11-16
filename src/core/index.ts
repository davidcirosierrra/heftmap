import path from 'node:path';
import { categorize, extOf, isConventionalEntry, isGenerated, isNotAnalyzedCategory, isSourceCategory } from './classify.js';
import { listFiles, listIgnoredDirs, readFile } from './files.js';
import { gitInfo, readHistory, readStatus } from './git.js';
import { pathMatcher } from './glob.js';
import { DEFAULT_WEAK_SOURCES } from './limits.js';
import type { BuildHooks, BuildOptions, FileEntry, HeftIndex, Phase, Usage, UsageRule, Warning } from './types.js';
import { analyzeUsage, packageEntryPoints } from './usage.js';
import { loadWorkspace } from './workspace.js';

export * from './types.js';

/** Construye el índice completo de un repo: archivos, git, uso y hotspots. */
export async function buildIndex(rootArg: string, opts: BuildOptions = {}, hooks: BuildHooks = {}): Promise<HeftIndex> {
  const root = path.resolve(rootArg);
  const publicDir = (opts.publicDir ?? 'public').replace(/^\/+|\/+$/g, '');
  const t0 = performance.now();
  const warnings: Warning[] = [];
  const progress = throttledProgress(hooks);

  // 1. Listado
  progress('list', 0, 0);
  const info = opts.useGit === false ? { isGit: false, prefix: '', head: null } : await gitInfo(root);
  if (info.warning) warnings.push(info.warning);
  const exclude = pathMatcher(opts.exclude ?? []);
  if (exclude.invalid.length) warnings.push({ code: 'invalid-exclude', patterns: exclude.invalid });
  const paths = (await listFiles(root, info.isGit)).filter((p) => !exclude.matches(p));
  const tList = performance.now();

  // 2. Lectura: tamaño, líneas y contenido de texto
  const files = new Map<string, FileEntry>();
  const texts = new Map<string, string>();
  let read = 0;
  progress('read', 0, paths.length);
  await mapLimit(paths, 32, async (rel) => {
    const r = await readFile(root, rel, opts.maxTextBytes);
    progress('read', ++read, paths.length);
    if (!r) return; // borrado del disco pero aún en el índice de git
    files.set(rel, {
      path: rel,
      size: r.size,
      ext: extOf(rel),
      category: categorize(rel),
      binary: r.binary,
      lines: r.lines,
      generated: isGenerated(rel),
      ignoredByGit: false,
      untracked: false,
      dirty: false,
      lastCommit: null,
      changes: 0,
      usage: 'not-analyzed',
      refsIn: [],
      refsOut: [],
    });
    if (r.text != null) texts.set(rel, r.text);
  });
  if (opts.includeIgnored && info.isGit) {
    for (const d of await listIgnoredDirs(root)) {
      if (exclude.matches(d.path)) continue;
      files.set(d.path, {
        path: d.path,
        size: d.size,
        ext: '',
        category: 'other',
        binary: false,
        lines: null,
        generated: true,
        ignoredByGit: true,
        untracked: false,
        dirty: false,
        lastCommit: null,
        changes: 0,
        usage: 'ignored-by-git',
        refsIn: [],
        refsOut: [],
      });
    }
  }
  const tRead = performance.now();

  // Tamaños listos: quien pinte puede enseñar ya el árbol mientras siguen git y el uso.
  // Copia de las entradas: las originales se siguen rellenando.
  hooks.onPartial?.({
    root,
    complete: false,
    isGit: info.isGit,
    head: info.head,
    commitsRead: 0,
    files: sortByPath([...files.values()].map((f) => ({ ...f, refsIn: [], refsOut: [] }))),
    timings: { list: tList - t0, read: tRead - tList, git: 0, usage: 0, total: tRead - t0 },
    warnings: [...warnings],
  });

  // 3. Git: último commit, nº de cambios, estado
  let commitsRead = 0;
  if (info.isGit) {
    progress('git', 0, 0);
    const [{ history, commits, warning }, status] = await Promise.all([
      readHistory(root, opts.since),
      readStatus(root, info.prefix),
    ]);
    if (warning) warnings.push(warning);
    commitsRead = commits;
    for (const f of files.values()) {
      if (f.ignoredByGit) continue;
      const h = history.get(f.path);
      if (h) {
        f.lastCommit = h.last;
        f.changes = h.changes;
      }
      f.untracked = status.untracked.has(f.path);
      f.dirty = status.dirty.has(f.path) || f.untracked;
    }
  }
  const tGit = performance.now();

  // 4. Uso
  const sources = [...files.values()].filter((f) => !f.ignoredByGit && isSourceCategory(f.category, f.path)).map((f) => f.path);
  const workspace = loadWorkspace(files, texts);
  const usage = analyzeUsage({ root, files, texts, sources, publicDir, workspace, onProgress: progress });
  warnings.push(...usage.warnings);
  for (const r of usage.refs) {
    files.get(r.from)?.refsOut.push(r);
    files.get(r.to)?.refsIn.push(r);
  }

  const entries = new Set(opts.entryPoints ?? []);
  const pkgText = texts.get('package.json');
  if (pkgText) for (const e of packageEntryPoints(pkgText)) entries.add(e);
  // Monorepos: la entrada de cada paquete, no solo la del de la raíz.
  for (const e of workspace.entryPoints()) entries.add(e);
  const ignore = new Set(opts.ignore ?? []);
  const weak = weakSourceTest(opts.weakSources ?? DEFAULT_WEAK_SOURCES);
  for (const f of files.values()) {
    const verdict = usageOf(f, entries, ignore, publicDir, weak);
    f.usage = verdict.usage;
    f.usageRule = verdict.rule;
  }
  const tUsage = performance.now();

  return {
    root,
    complete: true,
    isGit: info.isGit,
    head: info.head,
    commitsRead,
    files: sortByPath([...files.values()]),
    timings: {
      list: tList - t0,
      read: tRead - tList,
      git: tGit - tRead,
      usage: tUsage - tGit,
      total: tUsage - t0,
    },
    warnings,
  };
}

/** Estado de uso (SPEC §3.3) y la regla que lo decidió. El orden importa: la primera regla que encaja gana. */
function usageOf(
  f: FileEntry,
  entries: Set<string>,
  ignore: Set<string>,
  publicDir: string,
  isWeakSource: (from: string) => boolean,
): { usage: Usage; rule: UsageRule } {
  if (f.ignoredByGit) return { usage: 'ignored-by-git', rule: 'ignored-by-git' };
  if (ignore.has(f.path)) return { usage: 'exception', rule: 'ignore-setting' };
  if (isNotAnalyzedCategory(f.category)) return { usage: 'not-analyzed', rule: 'category' };
  const hard = f.refsIn.some((r) => r.kind !== 'mención' && !isWeakSource(r.from));
  if (hard) return { usage: 'referenced', rule: 'hard-ref' };
  if (entries.has(f.path)) return { usage: 'entry', rule: 'entry-declared' };
  if (isConventionalEntry(f.path, publicDir)) return { usage: 'entry', rule: 'entry-convention' };
  if (f.refsIn.length) return { usage: 'mentioned', rule: 'weak-ref' };
  return { usage: f.category === 'resource' ? 'none' : 'no-importers', rule: 'no-refs' };
}

/**
 * Referencias que no demuestran uso: scripts de tooling (un generador nombra lo que
 * escribe). Cuentan como mención. Son los scripts de otros lenguajes y lo que hay dentro de
 * las carpetas de tooling (`weakSources`). Los enlaces de Markdown ya se filtran en
 * usage/index.ts (solo hacia recursos y documentos), así que una imagen del README sí cuenta.
 */
function weakSourceTest(folders: readonly string[]): (from: string) => boolean {
  const prefixes = folders.map((f) => f.replace(/^\.?\/+|\/+$/g, '')).filter((f) => f !== '' && f !== '.').map((f) => `${f}/`);
  return (from) => categorize(from) === 'script' || prefixes.some((p) => from.startsWith(p));
}

function sortByPath(list: FileEntry[]): FileEntry[] {
  return list.sort((a, b) => a.path.localeCompare(b.path, 'es', { sensitivity: 'base' }));
}

/**
 * Avisos de progreso sin inundar a quien escucha (el worker los manda por mensaje):
 * siempre el primero y el último de cada fase; entre medias, como mucho uno cada 50 ms.
 */
function throttledProgress(hooks: BuildHooks): (phase: Phase, done: number, total: number) => void {
  let lastPhase: Phase | undefined;
  let lastAt = 0;
  return (phase, done, total) => {
    if (!hooks.onProgress) return;
    const now = performance.now();
    if (phase === lastPhase && done < total && now - lastAt < 50) return;
    lastPhase = phase;
    lastAt = now;
    hooks.onProgress({ phase, done, total });
  };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
