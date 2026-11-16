import { fileInScope, type Scope } from '../extension/scope.js';
import type { Usage } from '../core/types.js';
import type { PanelCommit, PanelFile, PanelRef } from '../extension/panel-protocol.js';

/**
 * Datos de la tabla (SPEC §2.2): filas, filtro y orden. Lógica pura, sin DOM ni React,
 * para poder probarla.
 */
export interface Row {
  path: string;
  name: string;
  /** Carpeta relativa, sin barra final; '' en la raíz. */
  folder: string;
  /** Extensión en minúsculas con punto ('.ts'); '' si no tiene. */
  ext: string;
  size: number;
  /** 'pending' mientras el índice está a medias (primer análisis). */
  usage: RowUsage;
  /** Nº de archivos que lo referencian o mencionan, de todo el repo. */
  refsIn: number;
  /** Último commit; null si no tiene (nuevo, fuera de `git.since`, sin git o índice a medias). */
  commit: PanelCommit | null;
  /** Cambios sin commit, incluidos los archivos nuevos. */
  dirty: boolean;
  untracked: boolean;
}

export type RowUsage = Usage | 'pending';

export type SortKey = 'name' | 'folder' | 'size' | 'usage' | 'changed';
export const SORT_KEYS: readonly SortKey[] = ['name', 'folder', 'size', 'usage', 'changed'];
export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: Sort = { key: 'name', dir: 'asc' };

/** Datos del índice que no son la lista de archivos. Por defecto: completo y sin referencias. */
export interface RowContext {
  complete?: boolean;
  refs?: readonly PanelRef[];
  commits?: readonly PanelCommit[];
}

/** Archivos del ámbito como filas. Las referencias se cuentan sobre todo el repo. */
export function toRows(files: readonly PanelFile[], scope: Scope, ctx: RowContext = {}): Row[] {
  const complete = ctx.complete ?? true;
  const refsIn = new Uint32Array(files.length);
  for (const [, to] of ctx.refs ?? []) if (to < refsIn.length) refsIn[to]!++;
  const rows: Row[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i] as PanelFile;
    if (!fileInScope(scope, f.path)) continue;
    const slash = f.path.lastIndexOf('/');
    const name = f.path.slice(slash + 1);
    const dot = name.lastIndexOf('.');
    rows.push({
      path: f.path,
      name,
      folder: slash < 0 ? '' : f.path.slice(0, slash),
      // `.gitignore` no tiene extensión: es su nombre.
      ext: dot > 0 ? name.slice(dot).toLowerCase() : '',
      size: f.size,
      usage: complete ? (f.usage ?? 'not-analyzed') : 'pending',
      refsIn: refsIn[i] ?? 0,
      commit: (complete && f.commit !== undefined && ctx.commits?.[f.commit]) || null,
      dirty: complete && !!f.dirty,
      untracked: complete && !!f.untracked,
    });
  }
  return rows;
}

/** Sin mayúsculas ni tildes: «camara» encuentra «Cámara.ts». */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Filtro por nombre o ruta. Varias palabras: tienen que aparecer todas. */
export function filterRows(rows: readonly Row[], text: string): Row[] {
  const terms = fold(text).split(/\s+/).filter(Boolean);
  if (!terms.length) return [...rows];
  return rows.filter((r) => {
    const hay = fold(r.path);
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Momento del último cambio, para ordenar: lo que aún no tiene commit (nuevo) es lo más
 * reciente; lo que no tiene dato (sin git, fuera de `git.since`) va al final.
 */
export function changedAt(r: Row): number {
  if (r.untracked) return Number.MAX_SAFE_INTEGER;
  return r.commit ? r.commit.time : 0;
}

const USAGE_ORDER: readonly RowUsage[] = ['none', 'no-importers', 'mentioned', 'referenced', 'entry', 'exception', 'not-analyzed', 'ignored-by-git', 'pending'];

/** Filtros rápidos de la barra superior (SPEC §2.2). */
export type Quick = 'all' | 'none' | 'mentioned' | 'entry' | 'dirty';

export const QUICK_LABEL: Record<Quick, string> = {
  all: 'Todos',
  none: 'Sin rastro',
  mentioned: 'Mencionados',
  entry: 'Puntos de entrada',
  dirty: 'Con cambios sin commit',
};

const QUICK_TEST: Record<Quick, (r: Row) => boolean> = {
  all: () => true,
  none: (r) => r.usage === 'none',
  mentioned: (r) => r.usage === 'mentioned',
  entry: (r) => r.usage === 'entry',
  dirty: (r) => r.dirty,
};

export function quickRows(rows: readonly Row[], quick: Quick): Row[] {
  return quick === 'all' ? [...rows] : rows.filter(QUICK_TEST[quick]);
}

export function quickCounts(rows: readonly Row[]): Record<Quick, number> {
  const out = { all: rows.length, none: 0, mentioned: 0, entry: 0, dirty: 0 } satisfies Record<Quick, number>;
  for (const r of rows) {
    if (r.dirty) out.dirty++;
    if (r.usage === 'none') out.none++;
    else if (r.usage === 'mentioned') out.mentioned++;
    else if (r.usage === 'entry') out.entry++;
  }
  return out;
}

/** Referencias de un archivo en los dos sentidos, con ruta y tipo. */
export interface Link {
  path: string;
  kind: PanelRef[2];
  /** false: el otro extremo está fuera del ámbito (se muestra marcado, SPEC §2.2). */
  inScope: boolean;
}

export function linksOf(files: readonly PanelFile[], refs: readonly PanelRef[], path: string, scope: Scope): { usedBy: Link[]; uses: Link[] } {
  const at = files.findIndex((f) => f.path === path);
  const usedBy: Link[] = [];
  const uses: Link[] = [];
  if (at < 0) return { usedBy, uses };
  const link = (i: number, kind: PanelRef[2]): Link | undefined => {
    const f = files[i];
    return f && { path: f.path, kind, inScope: fileInScope(scope, f.path) };
  };
  for (const [from, to, kind] of refs) {
    if (to === at) {
      const l = link(from, kind);
      if (l) usedBy.push(l);
    }
    if (from === at) {
      const l = link(to, kind);
      if (l) uses.push(l);
    }
  }
  const byPath = (a: Link, b: Link): number => collator.compare(a.path, b.path);
  return { usedBy: usedBy.sort(byPath), uses: uses.sort(byPath) };
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Devuelve una copia ordenada. A igualdad, por ruta, para que el orden sea estable. */
export function sortRows(rows: readonly Row[], sort: Sort): Row[] {
  const by: Record<SortKey, (a: Row, b: Row) => number> = {
    name: (a, b) => collator.compare(a.name, b.name),
    folder: (a, b) => collator.compare(a.folder, b.folder) || collator.compare(a.name, b.name),
    size: (a, b) => a.size - b.size,
    // Lo más sospechoso primero; dentro de cada estado, lo menos referenciado.
    usage: (a, b) => USAGE_ORDER.indexOf(a.usage) - USAGE_ORDER.indexOf(b.usage) || a.refsIn - b.refsIn,
    changed: (a, b) => changedAt(a) - changedAt(b),
  };
  const cmp = by[sort.key];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * cmp(a, b) || collator.compare(a.path, b.path));
}

/** Clic en una cabecera: misma columna invierte; otra empieza por su sentido natural. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  // Tamaño y fecha empiezan por lo grande y lo reciente.
  return { key, dir: key === 'size' || key === 'changed' ? 'desc' : 'asc' };
}

export function totalSize(rows: readonly Row[]): number {
  let total = 0;
  for (const r of rows) total += r.size;
  return total;
}

/** Filas visibles de una lista virtual de altura de fila fija, con margen por arriba y abajo. */
export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 8): { start: number; end: number } {
  // Tras filtrar, la lista puede ser más corta que el desplazamiento guardado.
  const start = Math.min(count, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}
