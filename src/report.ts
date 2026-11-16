import type { FileEntry, HeftIndex, Usage } from './core/index.js';

export const USAGE_LABEL: Record<Usage, string> = {
  referenced: 'Referenciado',
  mentioned: 'Mencionado',
  none: 'Sin rastro',
  'no-importers': 'Sin importadores',
  entry: 'Punto de entrada',
  'not-analyzed': 'No analizado',
  exception: 'Excepción',
  'ignored-by-git': 'Ignorado por git',
};

const KB = 1024;
const MB = KB * 1024;

export function fmtSize(b: number): string {
  if (b < KB) return `${b} B`;
  if (b < MB) return `${Math.round(b / KB)} KB`;
  const m = b / MB;
  return `${m >= 100 ? Math.round(m) : m.toFixed(1).replace('.', ',')} MB`;
}

/** Porcentaje como en el SPEC §2.1: «51 %»; un decimal solo por debajo del 10 %. */
export function pct(x: number): string {
  if (x <= 0) return '0 %';
  if (x < 0.001) return '<0,1 %';
  return `${(x * 100).toFixed(x >= 0.0995 ? 0 : 1).replace('.', ',')} %`;
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2).replace('.', ',')} s`;
}

export function rel(time: number, now = Date.now()): string {
  const d = Math.floor((now - time) / 86_400_000);
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 7) return `hace ${d} d`;
  if (d < 60) return `hace ${Math.round(d / 7)} sem`;
  if (d < 730) return `hace ${Math.round(d / 30)} meses`;
  return `hace ${Math.round(d / 365)} años`;
}

/** Hotspots (SPEC §3.5): código propio, sin generados, ordenado por cambios y luego líneas. */
export function hotspots(index: HeftIndex, top: number): FileEntry[] {
  return index.files
    .filter((f) => !f.generated && f.lines != null && f.changes > 0 && ['code', 'style', 'markup'].includes(f.category))
    .sort((a, b) => b.changes - a.changes || (b.lines ?? 0) - (a.lines ?? 0))
    .slice(0, top);
}

function table(rows: string[][], align: ('l' | 'r')[]): string {
  const widths = align.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows
    .map((r) =>
      '  ' +
      r.map((c, i) => (align[i] === 'r' ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0))).join('  ').trimEnd(),
    )
    .join('\n');
}

function lastChange(f: FileEntry): string {
  if (f.untracked) return 'nuevo';
  if (!f.lastCommit) return '—';
  return `${f.lastCommit.short} ${rel(f.lastCommit.time)}${f.dirty ? ' ●' : ''}`;
}

export function renderReport(index: HeftIndex, top = 10): string {
  const out: string[] = [];
  const files = index.files.filter((f) => !f.ignoredByGit);
  const total = files.reduce((s, f) => s + f.size, 0);
  const totalLines = files.reduce((s, f) => s + (f.lines ?? 0), 0);

  out.push(`Heft · ${index.root}`);
  out.push(
    `${files.length} archivos · ${fmtSize(total)} · ${totalLines.toLocaleString('es-ES')} líneas · ` +
      (index.isGit ? `git: ${index.commitsRead} commits leídos, HEAD ${index.head?.slice(0, 7) ?? '—'}` : 'sin git'),
  );
  const t = index.timings;
  out.push(
    `Tiempos: listado ${fmtMs(t.list)} · lectura ${fmtMs(t.read)} · git ${fmtMs(t.git)} · uso ${fmtMs(t.usage)} · total ${fmtMs(t.total)}`,
  );

  // Por categoría
  const byCat = new Map<string, { n: number; size: number }>();
  for (const f of files) {
    const c = byCat.get(f.category) ?? { n: 0, size: 0 };
    c.n++;
    c.size += f.size;
    byCat.set(f.category, c);
  }
  out.push(
    '\nPor categoría: ' +
      [...byCat.entries()]
        .sort((a, b) => b[1].size - a[1].size)
        .map(([k, v]) => `${k} ${v.n} (${fmtSize(v.size)})`)
        .join(' · '),
  );

  // Uso
  const counts = new Map<Usage, number>();
  for (const f of index.files) counts.set(f.usage, (counts.get(f.usage) ?? 0) + 1);
  out.push(
    'Uso: ' +
      (Object.keys(USAGE_LABEL) as Usage[])
        .filter((u) => counts.get(u))
        .map((u) => `${USAGE_LABEL[u]} ${counts.get(u)}`)
        .join(' · '),
  );

  const section = (title: string, list: FileEntry[], cols: (f: FileEntry) => string[], align: ('l' | 'r')[]): void => {
    out.push(`\n${title} (${list.length})`);
    if (!list.length) out.push('  —');
    else out.push(table(list.map(cols), align));
  };

  const none = files.filter((f) => f.usage === 'none').sort((a, b) => b.size - a.size);
  section('Sin rastro · candidatos a borrar', none, (f) => [f.path, fmtSize(f.size), lastChange(f)], ['l', 'r', 'l']);

  const mentioned = files.filter((f) => f.usage === 'mentioned').sort((a, b) => b.size - a.size);
  section(
    'Mencionados · revisar a mano',
    mentioned,
    (f) => {
      const from = f.refsIn.map((r) => r.from);
      const more = from.length > 3 ? ` y ${from.length - 3} más` : '';
      return [f.path, fmtSize(f.size), `en ${from.slice(0, 3).join(', ')}${more}`];
    },
    ['l', 'r', 'l'],
  );

  const noImp = files.filter((f) => f.usage === 'no-importers');
  section(
    'Código sin importadores · baja confianza, mejor Knip',
    noImp,
    (f) => [f.path, `${f.lines ?? '—'} líneas`, lastChange(f)],
    ['l', 'r', 'l'],
  );

  const hs = hotspots(index, top);
  section(
    `Hotspots · top ${top} por cambios, luego líneas (sin generados)`,
    hs,
    (f) => [f.path, `${f.lines} líneas`, `${f.changes} cambios`, lastChange(f)],
    ['l', 'r', 'r', 'l'],
  );

  const heavy = [...files].sort((a, b) => b.size - a.size).slice(0, top);
  section(
    `Más pesados · top ${top}`,
    heavy,
    (f) => [f.path, fmtSize(f.size), USAGE_LABEL[f.usage], `${f.refsIn.length} refs`],
    ['l', 'r', 'l', 'r'],
  );

  const ign = index.files.filter((f) => f.ignoredByGit).sort((a, b) => b.size - a.size);
  if (ign.length) section('Ignorados por git', ign, (f) => [f.path + '/', fmtSize(f.size)], ['l', 'r']);

  if (index.warnings.length) {
    out.push('\nAvisos');
    for (const w of index.warnings) out.push(`  · ${w}`);
  }
  return out.join('\n');
}
