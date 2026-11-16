import type { PanelCommit } from '../extension/panel-protocol.js';
import { rel, USAGE_LABEL } from '../report.js';
import type { Row, RowUsage } from './model.js';

/**
 * Color de cada archivo según el modo activo (SPEC §2.2) y su leyenda. Lógica pura.
 * Cada modo reparte los archivos en grupos (`key`); la leyenda es la lista de grupos.
 */
export type ColorMode = 'ext' | 'usage' | 'age' | 'recent' | 'changes';

export const COLOR_LABEL: Record<ColorMode, string> = {
  ext: 'Extensión',
  usage: 'Uso',
  age: 'Antigüedad',
  recent: 'Commits recientes',
  changes: 'Cambios',
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

/** De reciente (cálido) a antiguo (frío). */
export const AGE_COLORS = ['#d7301f', '#fc8d59', '#fdcc8a', '#9ecae1', '#6b8fb5'];
const NEW = 'nuevo';
const NO_DATA = 'sin-dato';

/**
 * Cortes por cuantiles: reparte `values` en hasta `n` tramos, de mayor a menor, con más o
 * menos los mismos elementos, y devuelve el valor mínimo de cada tramo.
 *
 * Valores iguales nunca se parten entre dos tramos. Un valor que por sí solo llena más de
 * un tramo (el commit inicial que toca medio repo) se queda con un tramo para él, y el resto
 * de tramos se reparte entre los demás valores: con cuantiles a secas, ese valor se tragaría
 * los cortes y todo saldría de un solo color.
 */
export function quantileFloors(values: readonly number[], n: number): number[] {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.value - a.value);
  if (!groups.length || n < 1) return [];

  // Valores «grandes»: tramo propio. Los tramos intermedios (rachas de valores pequeños)
  // necesitan al menos un tramo cada uno; si no caben, el grande menos grande deja de serlo.
  const big = new Set(groups.filter((g) => g.count > values.length / n).sort((a, b) => b.count - a.count));
  const runs = (): { value: number; count: number }[][] => {
    const out: { value: number; count: number }[][] = [];
    let run: { value: number; count: number }[] = [];
    for (const g of groups) {
      if (big.has(g)) {
        if (run.length) out.push(run);
        run = [];
      } else run.push(g);
    }
    if (run.length) out.push(run);
    return out;
  };
  let small = runs();
  while (big.size && big.size + small.length > n) {
    big.delete([...big].at(-1)!);
    small = runs();
  }

  // Reparto de los tramos libres entre las rachas: uno a cada una y el resto a la más cargada.
  const size = (run: { count: number }[]): number => run.reduce((s, g) => s + g.count, 0);
  const share = new Map(small.map((run) => [run, 1]));
  for (let free = n - big.size - small.length; free > 0; free--) {
    const neediest = small.filter((r) => (share.get(r) as number) < r.length).sort((a, b) => size(b) / (share.get(b) as number) - size(a) / (share.get(a) as number))[0];
    if (!neediest) break;
    share.set(neediest, (share.get(neediest) as number) + 1);
  }

  const floors: number[] = [];
  let run = 0;
  for (let i = 0; i < groups.length; ) {
    const g = groups[i] as { value: number; count: number };
    if (big.has(g)) {
      floors.push(g.value);
      i++;
      continue;
    }
    const current = small[run++] as { value: number; count: number }[];
    const parts = share.get(current) as number;
    const total = size(current);
    let seen = 0;
    let closed = 0;
    current.forEach((x, j) => {
      seen += x.count;
      const left = current.length - 1 - j;
      // Se cierra el tramo al llegar a su parte, o si ya solo quedan valores para los que faltan.
      if (seen >= (total * (closed + 1)) / parts || left < parts - closed - 1 || left === 0) {
        if (closed < parts) {
          floors.push(x.value);
          closed++;
        } else floors[floors.length - 1] = x.value;
      }
    });
    i += current.length;
  }
  return floors;
}

/** Antigüedad (SPEC §2.2): 5 tramos por cuantiles del propio repo, no por fechas fijas. */
function byAge(rows: readonly Row[], now: number): Coloring {
  const floors = quantileFloors(rows.filter((r) => r.commit && !r.untracked).map((r) => (r.commit as PanelCommit).time), AGE_COLORS.length);
  const keyOf = (r: Row): string => {
    if (r.untracked) return NEW;
    if (!r.commit) return NO_DATA;
    const t = r.commit.time;
    return `t${Math.max(0, floors.findIndex((f) => t >= f))}`;
  };
  const groups = floors.map((floor, i) => {
    const newest = i === 0 ? null : (floors[i - 1] as number);
    const from = rel(floor, now);
    // Primer tramo: «hasta hace 2 sem»; los demás: «hace 2 sem – hace 3 meses».
    const to = newest === null ? null : rel(newest, now);
    const label = to === null ? (from === 'hoy' ? 'hoy' : `hasta ${from}`) : to === from ? from : `${to} – ${from}`;
    // Con menos de 5 tramos se reparten los colores de punta a punta.
    const color = AGE_COLORS[floors.length === 1 ? 0 : Math.round((i * (AGE_COLORS.length - 1)) / (floors.length - 1))] as string;
    return { key: `t${i}`, label, color };
  });
  return fixedGroups('age', rows, keyOf, [
    { key: NEW, label: 'Nuevo (sin commit)', color: '#b07aa1' },
    ...groups,
    { key: NO_DATA, label: 'Sin dato de git', color: NEUTRAL },
  ]);
}

export const RECENT_COMMITS = 8;

/** Commits recientes (SPEC §2.2 y §3.4): color solo para los últimos 8; el resto en gris. */
function byRecent(rows: readonly Row[]): Coloring {
  const seen = new Map<string, PanelCommit>();
  for (const r of rows) if (r.commit) seen.set(r.commit.hash, r.commit);
  const latest = [...seen.values()].sort((a, b) => b.time - a.time).slice(0, RECENT_COMMITS);
  const recent = new Set(latest.map((c) => c.hash));
  const short = (s: string): string => (s.length > 34 ? s.slice(0, 33) + '…' : s);
  return fixedGroups('recent', rows, (r) => (r.untracked ? NEW : r.commit && recent.has(r.commit.hash) ? r.commit.hash : NO_DATA), [
    { key: NEW, label: 'Nuevo (sin commit)', color: '#bab0ac' },
    ...latest.map((c, i) => ({ key: c.hash, label: `${c.short} ${short(c.subject)}`, color: CATEGORICAL[i] as string })),
    { key: NO_DATA, label: 'Anteriores', color: '#5f5f5f' },
  ]);
}

/** Un solo tono, de intenso (muy tocado) a apagado (poco tocado). */
export const CHANGE_COLORS = ['#e8590c', '#f08c3f', '#f2ae7b', '#d9bfa8', '#a79c93'];
const STABLE = 'estable';
const GENERATED = 'generado';

/**
 * Cambios (SPEC §2.2 y §3.5): de gris (estable) a intenso (muy tocado), por cuantiles del
 * repo. Lockfiles y generados quedan fuera: cambian mucho y no dicen nada.
 */
function byChanges(rows: readonly Row[]): Coloring {
  const floors = quantileFloors(rows.filter((r) => !r.generated && r.changes > 0).map((r) => r.changes), CHANGE_COLORS.length);
  const keyOf = (r: Row): string => {
    if (r.generated) return GENERATED;
    if (r.changes <= 0) return STABLE;
    return `c${Math.max(0, floors.findIndex((f) => r.changes >= f))}`;
  };
  const n = (x: number): string => x.toLocaleString('es-ES');
  const groups = floors.map((floor, i) => {
    const top = i === 0 ? null : (floors[i - 1] as number) - 1;
    const label = top === null ? `${n(floor)} o más` : top === floor ? `${n(floor)} ${floor === 1 ? 'cambio' : 'cambios'}` : `${n(floor)}–${n(top)}`;
    const color = CHANGE_COLORS[floors.length === 1 ? 0 : Math.round((i * (CHANGE_COLORS.length - 1)) / (floors.length - 1))] as string;
    return { key: `c${i}`, label: i === 0 && top === null ? `${label} cambios` : label, color };
  });
  return fixedGroups('changes', rows, keyOf, [
    ...groups,
    { key: STABLE, label: 'Sin cambios registrados', color: '#6b6b6b' },
    { key: GENERATED, label: 'Generado o lockfile', color: '#4d4d4d' },
  ]);
}

export function coloring(mode: ColorMode, rows: readonly Row[], now = Date.now()): Coloring {
  const modes: Record<ColorMode, (rows: readonly Row[]) => Coloring> = { ext: byExt, usage: byUsage, age: (r) => byAge(r, now), recent: byRecent, changes: byChanges };
  return modes[mode](rows);
}
