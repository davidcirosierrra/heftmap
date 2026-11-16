import { fileInScope, type Scope } from '../extension/scope.js';
import type { PanelFile } from '../extension/panel-protocol.js';

/**
 * Datos de la tabla (SPEC §2.2): filas, filtro y orden. Lógica pura, sin DOM ni React,
 * para poder probarla.
 */
export interface Row {
  path: string;
  name: string;
  /** Carpeta relativa, sin barra final; '' en la raíz. */
  folder: string;
  size: number;
}

export type SortKey = 'name' | 'folder' | 'size';
export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: Sort = { key: 'name', dir: 'asc' };

/** Archivos del ámbito como filas. */
export function toRows(files: readonly PanelFile[], scope: Scope): Row[] {
  const rows: Row[] = [];
  for (const f of files) {
    if (!fileInScope(scope, f.path)) continue;
    const slash = f.path.lastIndexOf('/');
    rows.push({ path: f.path, name: f.path.slice(slash + 1), folder: slash < 0 ? '' : f.path.slice(0, slash), size: f.size });
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

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Devuelve una copia ordenada. A igualdad, por ruta, para que el orden sea estable. */
export function sortRows(rows: readonly Row[], sort: Sort): Row[] {
  const by: Record<SortKey, (a: Row, b: Row) => number> = {
    name: (a, b) => collator.compare(a.name, b.name),
    folder: (a, b) => collator.compare(a.folder, b.folder) || collator.compare(a.name, b.name),
    size: (a, b) => a.size - b.size,
  };
  const cmp = by[sort.key];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * cmp(a, b) || collator.compare(a.path, b.path));
}

/** Clic en una cabecera: misma columna invierte; otra empieza por su sentido natural. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'size' ? 'desc' : 'asc' };
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
