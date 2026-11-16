import path from 'node:path';
import { categorize, extOf, isConventionalEntry, isGenerated, isNotAnalyzedCategory, isSourceCategory } from './classify.js';
import { listFiles, listIgnoredDirs, readFile } from './files.js';
import { gitInfo, readHistory, readStatus } from './git.js';
import type { BuildHooks, BuildOptions, FileEntry, HeftIndex, Phase, Usage } from './types.js';
import { analyzeUsage, packageEntryPoints } from './usage.js';

export * from './types.js';

/** Construye el índice completo de un repo: archivos, git, uso y hotspots. */
export async function buildIndex(rootArg: string, opts: BuildOptions = {}, hooks: BuildHooks = {}): Promise<HeftIndex> {
  const root = path.resolve(rootArg);
  const publicDir = (opts.publicDir ?? 'public').replace(/^\/+|\/+$/g, '');
  const t0 = performance.now();
  const warnings: string[] = [];
  const progress = throttledProgress(hooks);

  // 1. Listado
  progress('list', 0, 0);
  const info = await gitInfo(root);
  if (info.warning) warnings.push(info.warning);
  const paths = await listFiles(root, info.isGit);
  const tList = performance.now();

  // 2. Lectura: tamaño, líneas y contenido de texto
  const files = new Map<string, FileEntry>();
  const texts = new Map<string, string>();
  let read = 0;
  progress('read', 0, paths.length);
  await mapLimit(paths, 32, async (rel) => {
    const r = await readFile(root, rel);
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
  const usage = analyzeUsage({ root, files, texts, sources, publicDir, onProgress: progress });
  warnings.push(...usage.warnings);
  for (const r of usage.refs) {
    files.get(r.from)?.refsOut.push(r);
    files.get(r.to)?.refsIn.push(r);
  }

  const entries = new Set(opts.entryPoints ?? []);
  const pkgText = texts.get('package.json');
  if (pkgText) for (const e of packageEntryPoints(pkgText)) entries.add(e);
  const ignore = new Set(opts.ignore ?? []);
  for (const f of files.values()) f.usage = usageOf(f, entries, ignore, publicDir);
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

/** Estado de uso (SPEC §3.3). El orden importa: la primera regla que encaja gana. */
function usageOf(f: FileEntry, entries: Set<string>, ignore: Set<string>, publicDir: string): Usage {
  if (f.ignoredByGit) return 'ignored-by-git';
  if (ignore.has(f.path)) return 'exception';
  if (isNotAnalyzedCategory(f.category)) return 'not-analyzed';
  const hard = f.refsIn.some((r) => r.kind !== 'mención' && !isWeakSource(r.from));
  if (hard) return 'referenced';
  if (entries.has(f.path) || isConventionalEntry(f.path, publicDir)) return 'entry';
  if (f.refsIn.length) return 'mentioned';
  return f.category === 'resource' ? 'none' : 'no-importers';
}

/**
 * Referencias que no demuestran uso: scripts de tooling (un generador nombra lo que
 * escribe). Cuentan como mención. Los enlaces de Markdown ya se filtran en usage.ts
 * (solo hacia recursos y documentos), así que una imagen del README sí cuenta.
 */
function isWeakSource(from: string): boolean {
  return categorize(from) === 'script' || /^(scripts|tools|bin)\//.test(from);
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
