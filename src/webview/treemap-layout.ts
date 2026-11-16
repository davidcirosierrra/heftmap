import type { PanelArea } from '../extension/panel-protocol.js';
import type { MessageKey } from '../i18n/index.js';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import type { Row } from './model.js';

/**
 * Treemap 2D anidado por carpetas (SPEC §2.2). Lógica pura: de filas a rectángulos.
 * El componente solo pinta lo que sale de aquí.
 */
export type AreaMode = PanelArea;

/** Clave del texto de cada modo (src/i18n). */
export const AREA_LABEL = {
  bytes: 'area.bytes',
  balanced: 'area.balanced',
  lines: 'area.lines',
} as const satisfies Record<AreaMode, MessageKey>;

/** Valor que decide el área de un archivo. 0 = no se dibuja. */
export function areaValue(row: Row, mode: AreaMode): number {
  // Líneas: solo archivos de texto; los binarios no se dibujan.
  if (mode === 'lines') return row.lines ?? 0;
  // Equilibrado: √bytes, para que el código no desaparezca junto a los binarios.
  return mode === 'balanced' ? Math.sqrt(row.size) : row.size;
}

export interface Cell {
  kind: 'dir' | 'file';
  /** Ruta relativa; '' para la raíz. */
  path: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bytes reales (suma en carpetas), sea cual sea el modo de área. */
  size: number;
  /** Líneas de los archivos dibujados (suma en carpetas). */
  lines: number;
  /** Nº de archivos (1 en archivos). */
  count: number;
  /** Carpeta con cabecera visible (nombre y tamaño). */
  header: boolean;
  row?: Row;
}

interface Node {
  name: string;
  path: string;
  size: number;
  lines: number;
  count: number;
  value: number;
  row?: Row;
  children?: Node[];
  dirs?: Map<string, Node>;
}

export const HEADER_HEIGHT = 18;
/** Por debajo de esto una carpeta no lleva cabecera: se comería el contenido. */
const MIN_HEADER_W = 44;
const MIN_HEADER_H = 34;

export interface LayoutOptions {
  width: number;
  height: number;
  area: AreaMode;
  /** Carpeta ampliada; '' = todo. Si no existe entre las filas, se ignora. */
  zoom: string;
}

/** Carpeta desde la que se dibuja de verdad: `zoom` si existe, si no la raíz. */
export function effectiveZoom(rows: readonly Row[], zoom: string): string {
  if (!zoom) return '';
  return rows.some((r) => r.folder === zoom || r.folder.startsWith(zoom + '/')) ? zoom : '';
}

export function layoutTreemap(rows: readonly Row[], opts: LayoutOptions): Cell[] {
  const { width, height } = opts;
  if (width < 4 || height < 4) return [];
  const zoom = effectiveZoom(rows, opts.zoom);
  const prefix = zoom ? zoom + '/' : '';

  const root: Node = { name: zoom.slice(zoom.lastIndexOf('/') + 1), path: zoom, size: 0, lines: 0, count: 0, value: 0, children: [], dirs: new Map() };
  for (const row of rows) {
    if (prefix && !row.path.startsWith(prefix)) continue;
    const value = areaValue(row, opts.area);
    if (!(value > 0)) continue;
    const parts = row.path.slice(prefix.length).split('/');
    let node = root;
    const lines = row.lines ?? 0;
    node.size += row.size;
    node.lines += lines;
    node.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i] as string;
      let child = node.dirs!.get(name);
      if (!child) {
        child = { name, path: prefix + parts.slice(0, i + 1).join('/'), size: 0, lines: 0, count: 0, value: 0, children: [], dirs: new Map() };
        node.dirs!.set(name, child);
        node.children!.push(child);
      }
      child.size += row.size;
      child.lines += lines;
      child.count++;
      node = child;
    }
    node.children!.push({ name: row.name, path: row.path, size: row.size, lines, count: 1, value, row });
  }
  if (!root.count) return [];

  const tree = hierarchy<Node>(root, (d) => d.children)
    .sum((d) => (d.children ? 0 : d.value))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const hasHeader = (d: { x0: number; x1: number; y0: number; y1: number; depth: number }): boolean =>
    d.depth > 0 && d.x1 - d.x0 >= MIN_HEADER_W && d.y1 - d.y0 >= MIN_HEADER_H;
  const laid = treemap<Node>()
    .tile(treemapSquarify)
    .size([width, height])
    .round(true)
    .paddingInner(1)
    // d3 llama a esto con la caja de la carpeta ya calculada: la cabecera depende de si cabe.
    .paddingTop((d) => (d.children && hasHeader(d) ? HEADER_HEIGHT : 0))(tree);

  const cells: Cell[] = [];
  for (const d of laid.descendants()) {
    if (d.depth === 0) continue;
    const w = d.x1 - d.x0;
    const h = d.y1 - d.y0;
    if (w < 1 || h < 1) continue; // demasiado pequeño para verse
    const isDir = !!d.data.children;
    cells.push({
      kind: isDir ? 'dir' : 'file',
      path: d.data.path,
      name: d.data.name,
      x: d.x0,
      y: d.y0,
      w,
      h,
      size: d.data.size,
      lines: d.data.lines,
      count: d.data.count,
      header: isDir && hasHeader(d),
      row: d.data.row,
    });
  }
  return cells;
}

/** Migas del zoom: [{ '', raíz }, { 'src', 'src' }, { 'src/game', 'game' }]. */
export function crumbs(zoom: string, rootName: string): { path: string; name: string }[] {
  const out = [{ path: '', name: rootName }];
  if (!zoom) return out;
  const parts = zoom.split('/');
  parts.forEach((name, i) => out.push({ path: parts.slice(0, i + 1).join('/'), name }));
  return out;
}

/** Texto que cabe en `width` píxeles (estimación por ancho medio de carácter). */
export function fitText(text: string, width: number, charWidth = 6.6): string {
  const max = Math.floor(width / charWidth);
  if (max >= text.length) return text;
  return max < 3 ? '' : text.slice(0, max - 1) + '…';
}
