import { isHotspotCategory } from './core/classify.js';
import type { FileEntry, HeftIndex, Usage } from './core/index.js';
import { i18n, type I18n } from './i18n/index.js';
import { warningText } from './i18n/warnings.js';

/**
 * Formatos y textos del informe del CLI. El CLI es una herramienta de desarrollo y su informe
 * está en castellano; los formatos (tamaños, %, fechas) salen de src/i18n como en la extensión.
 */
const ES = i18n('es');
export const usageLabel = (u: Usage, I: I18n = ES): string => I.t(`usage.${u}`);
const fmtSize = ES.size;
const fmtMs = ES.ms;
const rel = (time: number): string => ES.rel(time);

/** Hotspots (SPEC §3.5): código propio, sin generados, ordenado por cambios y luego líneas. */
export function hotspots(index: HeftIndex, top: number): FileEntry[] {
  return index.files
    .filter((f) => !f.generated && f.lines != null && f.changes > 0 && isHotspotCategory(f.category))
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
    `${files.length} archivos · ${fmtSize(total)} · ${ES.num(totalLines)} líneas · ` +
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
      (['referenced', 'mentioned', 'none', 'no-importers', 'entry', 'not-analyzed', 'exception', 'ignored-by-git'] as Usage[])
        .filter((u) => counts.get(u))
        .map((u) => `${usageLabel(u)} ${counts.get(u)}`)
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
    (f) => [f.path, fmtSize(f.size), usageLabel(f.usage), `${f.refsIn.length} refs`],
    ['l', 'r', 'l', 'r'],
  );

  const ign = index.files.filter((f) => f.ignoredByGit).sort((a, b) => b.size - a.size);
  if (ign.length) section('Ignorados por git', ign, (f) => [f.path + '/', fmtSize(f.size)], ['l', 'r']);

  if (index.warnings.length) {
    out.push('\nAvisos');
    for (const w of index.warnings) out.push(`  · ${warningText(w, ES)}`);
  }
  return out.join('\n');
}
