import { USAGE_LABEL } from '../report.js';
import type { Row, RowUsage } from './model.js';

/**
 * Color de cada archivo según el modo activo (SPEC §2.2) y su leyenda. Lógica pura.
 * Cada modo reparte los archivos en grupos (`key`); la leyenda es la lista de grupos.
 */
export type ColorMode = 'ext' | 'usage';

export const COLOR_LABEL: Record<ColorMode, string> = {
  ext: 'Extensión',
  usage: 'Uso',
};

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  count: number;
  size: number;
}

export interface Coloring {
  mode: ColorMode;
  keyOf(row: Row): string;
  colorOf(row: Row): string;
  legend: LegendItem[];
}

/**
 * Tonos medios: se distinguen entre sí y contrastan con el fondo en tema claro y oscuro.
 * El texto que va encima se elige con `textOn`.
 */
export const CATEGORICAL = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f'];
export const NEUTRAL = '#8a8a8a';
const OTHER = '(otros)';

/** Negro o blanco, lo que mejor se lea sobre `hex` (luminancia relativa WCAG). */
export function textOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.36 ? '#111111' : '#ffffff';
}

function groupLegend(rows: readonly Row[], keyOf: (r: Row) => string): Map<string, { count: number; size: number }> {
  const groups = new Map<string, { count: number; size: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = groups.get(k) ?? { count: 0, size: 0 };
    g.count++;
    g.size += r.size;
    groups.set(k, g);
  }
  return groups;
}

/** Las extensiones que más pesan tienen color propio; el resto va a «otros». */
function byExt(rows: readonly Row[]): Coloring {
  const extOf = (r: Row): string => r.ext || '(sin extensión)';
  const groups = groupLegend(rows, extOf);
  const ranked = [...groups.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  const color = new Map<string, string>();
  ranked.slice(0, CATEGORICAL.length).forEach(([ext], i) => color.set(ext, CATEGORICAL[i] as string));
  const keyOf = (r: Row): string => (color.has(extOf(r)) ? extOf(r) : OTHER);

  const legend: LegendItem[] = ranked
    .slice(0, CATEGORICAL.length)
    .map(([ext, g]) => ({ key: ext, label: ext, color: color.get(ext) as string, ...g }));
  const rest = ranked.slice(CATEGORICAL.length);
  if (rest.length) {
    legend.push({
      key: OTHER,
      label: `otros (${rest.length})`,
      color: NEUTRAL,
      count: rest.reduce((s, [, g]) => s + g.count, 0),
      size: rest.reduce((s, [, g]) => s + g.size, 0),
    });
  }
  return { mode: 'ext', keyOf, colorOf: (r) => color.get(extOf(r)) ?? NEUTRAL, legend };
}

/** Grupos fijos, en este orden; en la leyenda solo salen los que tienen archivos. */
function fixedGroups(mode: ColorMode, rows: readonly Row[], keyOf: (r: Row) => string, groups: readonly { key: string; label: string; color: string }[]): Coloring {
  const stats = groupLegend(rows, keyOf);
  const color = new Map(groups.map((g) => [g.key, g.color]));
  return {
    mode,
    keyOf,
    colorOf: (r) => color.get(keyOf(r)) ?? NEUTRAL,
    legend: groups.filter((g) => stats.has(g.key)).map((g) => ({ ...g, ...(stats.get(g.key) as { count: number; size: number }) })),
  };
}

export const USAGE_COLOR: Record<RowUsage, string> = {
  none: '#e15759',
  'no-importers': '#f28e2b',
  mentioned: '#edc948',
  referenced: '#59a14f',
  entry: '#4e79a7',
  exception: '#b07aa1',
  'not-analyzed': NEUTRAL,
  'ignored-by-git': '#5c5c5c',
  pending: '#6e6e6e',
};

export const usageLabel = (u: RowUsage): string => (u === 'pending' ? 'Analizando…' : USAGE_LABEL[u]);

function byUsage(rows: readonly Row[]): Coloring {
  const order: RowUsage[] = ['none', 'no-importers', 'mentioned', 'referenced', 'entry', 'exception', 'not-analyzed', 'ignored-by-git', 'pending'];
  return fixedGroups('usage', rows, (r) => r.usage, order.map((u) => ({ key: u, label: usageLabel(u), color: USAGE_COLOR[u] })));
}

export function coloring(mode: ColorMode, rows: readonly Row[]): Coloring {
  const modes: Record<ColorMode, (rows: readonly Row[]) => Coloring> = { ext: byExt, usage: byUsage };
  return modes[mode](rows);
}
