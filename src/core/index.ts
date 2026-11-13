import path from 'node:path';
import { categorize, extOf, isConventionalEntry, isGenerated, isNotAnalyzedCategory, isSourceCategory } from './classify.js';
import { listFiles, listIgnoredDirs, readFile } from './files.js';
import { gitInfo, readHistory, readStatus } from './git.js';
import type { BuildOptions, FileEntry, HeftIndex, Usage } from './types.js';
import { analyzeUsage, packageEntryPoints } from './usage.js';

export * from './types.js';

/** Construye el índice completo de un repo: archivos, git, uso y hotspots. */
export async function buildIndex(rootArg: string, opts: BuildOptions = {}): Promise<HeftIndex> {
  const root = path.resolve(rootArg);
  const publicDir = (opts.publicDir ?? 'public').replace(/^\/+|\/+$/g, '');
  const t0 = performance.now();
  const warnings: string[] = [];

  // 1. Listado
  const info = await gitInfo(root);
  if (info.warning) warnings.push(info.warning);
  const paths = await listFiles(root, info.isGit);
  const tList = performance.now();

  // 2. Lectura: tamaño, líneas y contenido de texto
  const files = new Map<string, FileEntry>();
  const texts = new Map<string, string>();
  await mapLimit(paths, 32, async (rel) => {
    const r = await readFile(root, rel);
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
      usage: 'none',
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

  // 3. Git: último commit, nº de cambios, estado
  let commitsRead = 0;
  if (info.isGit) {
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
  const usage = analyzeUsage({ root, files, texts, sources, publicDir });
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

  const sorted = [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'es', { sensitivity: 'base' }));
  return {
    root,
    isGit: info.isGit,
    head: info.head,
    commitsRead,
    files: sorted,
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
