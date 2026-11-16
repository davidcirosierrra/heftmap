import { describe, expect, it } from 'vitest';
import { coloring, quantileFloors } from '../src/webview/colors.js';
import { DEFAULT_SORT, filterRows, linksOf, nextSort, quickCounts, quickRows, sortRows, toRows, totalSize, visibleRange } from '../src/webview/model.js';
import type { PanelCommit, PanelFile, PanelRef } from '../src/extension/panel-protocol.js';

const files = [
  { path: 'README.md', size: 300 },
  { path: 'src/main.tsx', size: 120 },
  { path: 'src/game/Cámara.ts', size: 900 },
  { path: 'src/game/kart10.ts', size: 50 },
  { path: 'src/game/kart2.ts', size: 50 },
  { path: 'public/models/kart.glb', size: 4_000_000 },
  { path: 'srcdoc/x.md', size: 1 },
];
const names = (rows: { name: string }[]): string[] => rows.map((r) => r.name);

describe('tabla del panel: filas', () => {
  it('sin ámbito entran todos; nombre y carpeta salen de la ruta', () => {
    const rows = toRows(files, []);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ path: 'README.md', name: 'README.md', folder: '', ext: '.md', size: 300 });
    expect(toRows([{ path: '.gitignore', size: 1 }, { path: 'a/Logo.PNG', size: 1 }], []).map((r) => r.ext)).toEqual(['', '.png']);
    expect(rows[2]).toMatchObject({ name: 'Cámara.ts', folder: 'src/game' });
  });

  it('el ámbito recorta por carpeta, no por prefijo de texto', () => {
    expect(names(toRows(files, ['src']))).toEqual(['main.tsx', 'Cámara.ts', 'kart10.ts', 'kart2.ts']);
    expect(toRows(files, ['src/game', 'public'])).toHaveLength(4);
    expect(totalSize(toRows(files, ['src']))).toBe(1120);
  });
});

describe('tabla del panel: filtro', () => {
  const rows = toRows(files, []);
  it('busca en nombre y ruta, sin mayúsculas ni tildes', () => {
    expect(names(filterRows(rows, 'camara'))).toEqual(['Cámara.ts']);
    expect(names(filterRows(rows, 'MODELS'))).toEqual(['kart.glb']);
  });
  it('varias palabras: tienen que estar todas', () => {
    expect(names(filterRows(rows, 'game kart'))).toEqual(['kart10.ts', 'kart2.ts']);
    expect(filterRows(rows, 'game glb')).toEqual([]);
  });
  it('vacío o solo espacios no filtra', () => {
    expect(filterRows(rows, '  ')).toHaveLength(7);
  });
});

describe('tabla del panel: orden', () => {
  const rows = toRows(files, []);
  it('por defecto Nombre A→Z, sin distinguir mayúsculas y con números en orden natural', () => {
    expect(names(sortRows(rows, DEFAULT_SORT))).toEqual(['Cámara.ts', 'kart.glb', 'kart2.ts', 'kart10.ts', 'main.tsx', 'README.md', 'x.md']);
  });
  it('por tamaño; a igualdad, por ruta', () => {
    expect(names(sortRows(rows, { key: 'size', dir: 'desc' })).slice(0, 2)).toEqual(['kart.glb', 'Cámara.ts']);
    expect(names(sortRows(rows, { key: 'size', dir: 'asc' })).slice(0, 3)).toEqual(['x.md', 'kart2.ts', 'kart10.ts']);
  });
  it('por carpeta: la raíz primero y dentro de cada carpeta por nombre', () => {
    expect(sortRows(rows, { key: 'folder', dir: 'asc' }).map((r) => r.path)).toEqual([
      'README.md',
      'public/models/kart.glb',
      'src/main.tsx',
      'src/game/Cámara.ts',
      'src/game/kart2.ts',
      'src/game/kart10.ts',
      'srcdoc/x.md',
    ]);
  });
  it('no modifica la lista original', () => {
    const before = names(rows);
    sortRows(rows, { key: 'size', dir: 'desc' });
    expect(names(rows)).toEqual(before);
  });
  it('clic en cabecera: la misma invierte; Tamaño empieza de mayor a menor', () => {
    expect(nextSort(DEFAULT_SORT, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort(DEFAULT_SORT, 'size')).toEqual({ key: 'size', dir: 'desc' });
    expect(nextSort({ key: 'size', dir: 'desc' }, 'folder')).toEqual({ key: 'folder', dir: 'asc' });
  });
});

describe('tabla del panel: lista virtual', () => {
  it('solo las filas a la vista, con margen', () => {
    expect(visibleRange(0, 240, 24, 10_000)).toEqual({ start: 0, end: 18 });
    expect(visibleRange(2400, 240, 24, 10_000)).toEqual({ start: 92, end: 118 });
  });
  it('no se sale de la lista', () => {
    expect(visibleRange(0, 240, 24, 3)).toEqual({ start: 0, end: 3 });
    expect(visibleRange(99_999, 240, 24, 3)).toEqual({ start: 3, end: 3 });
    expect(visibleRange(0, 240, 24, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('uso (fase 4)', () => {
  const uFiles: PanelFile[] = [
    { path: 'index.html', size: 300, usage: 'entry' },
    { path: 'src/main.tsx', size: 120, usage: 'referenced' },
    { path: 'src/App.tsx', size: 900, usage: 'referenced' },
    { path: 'src/old.ts', size: 50, usage: 'no-importers' },
    { path: 'public/kart.glb', size: 4000, usage: 'referenced' },
    { path: 'public/trees.glb', size: 2800, usage: 'none' },
    { path: 'public/grass.png', size: 1800, usage: 'mentioned' },
    { path: 'README.md', size: 10, usage: 'not-analyzed' },
  ];
  const uRefs: PanelRef[] = [
    [0, 1, 'src/href'],
    [1, 2, 'import'],
    [2, 4, 'ruta en string'],
    [1, 4, 'ruta en string'],
    [2, 6, 'mención'],
  ];
  const all = toRows(uFiles, [], { refs: uRefs });
  const usageOf = (p: string) => all.find((r) => r.path === p)!;

  it('cada fila lleva su estado y cuántos archivos la referencian', () => {
    expect(usageOf('public/kart.glb')).toMatchObject({ usage: 'referenced', refsIn: 2 });
    expect(usageOf('public/trees.glb')).toMatchObject({ usage: 'none', refsIn: 0 });
    expect(usageOf('public/grass.png')).toMatchObject({ usage: 'mentioned', refsIn: 1 });
  });

  it('las referencias se cuentan sobre todo el repo, no sobre el ámbito', () => {
    const scoped = toRows(uFiles, ['public'], { refs: uRefs });
    expect(scoped.map((r) => r.path)).toEqual(['public/kart.glb', 'public/trees.glb', 'public/grass.png']);
    expect(scoped[0]!.refsIn).toBe(2);
  });

  it('con el índice a medias el uso está pendiente, no «no analizado»', () => {
    const partial = toRows(uFiles, [], { complete: false });
    expect(new Set(partial.map((r) => r.usage))).toEqual(new Set(['pending']));
    expect(quickCounts(partial)).toEqual({ all: 8, none: 0, mentioned: 0, entry: 0, dirty: 0 });
  });

  it('filtros rápidos y sus recuentos', () => {
    expect(quickCounts(all)).toEqual({ all: 8, none: 1, mentioned: 1, entry: 1, dirty: 0 });
    expect(quickRows(all, 'none').map((r) => r.path)).toEqual(['public/trees.glb']);
    expect(quickRows(all, 'mentioned').map((r) => r.path)).toEqual(['public/grass.png']);
    expect(quickRows(all, 'entry').map((r) => r.path)).toEqual(['index.html']);
    expect(quickRows(all, 'all')).toHaveLength(8);
  });

  it('ordenar por Uso: lo más sospechoso primero', () => {
    const order = sortRows(all, { key: 'usage', dir: 'asc' }).map((r) => r.usage);
    expect(order).toEqual(['none', 'no-importers', 'mentioned', 'referenced', 'referenced', 'referenced', 'entry', 'not-analyzed']);
    // Dentro de «referenciado», lo menos referenciado antes.
    const referenced = sortRows(all, { key: 'usage', dir: 'asc' }).filter((r) => r.usage === 'referenced');
    expect(referenced.at(-1)!.path).toBe('public/kart.glb');
  });

  it('«Lo usan» y «Usa», con el tipo y marcando lo de fuera del ámbito', () => {
    const { usedBy, uses } = linksOf(uFiles, uRefs, 'public/kart.glb', ['public']);
    expect(usedBy).toEqual([
      { path: 'src/App.tsx', kind: 'ruta en string', inScope: false },
      { path: 'src/main.tsx', kind: 'ruta en string', inScope: false },
    ]);
    expect(uses).toEqual([]);
    const app = linksOf(uFiles, uRefs, 'src/App.tsx', []);
    expect(app.usedBy).toEqual([{ path: 'src/main.tsx', kind: 'import', inScope: true }]);
    expect(app.uses.map((l) => `${l.path} (${l.kind})`)).toEqual(['public/grass.png (mención)', 'public/kart.glb (ruta en string)']);
    expect(linksOf(uFiles, uRefs, 'no/existe', [])).toEqual({ usedBy: [], uses: [] });
  });

  it('color «Uso»: un grupo por estado presente, en orden de sospecha', () => {
    const c = coloring('usage', all);
    expect(c.legend.map((l) => l.label)).toEqual(['Sin rastro', 'Sin importadores', 'Mencionado', 'Referenciado', 'Punto de entrada', 'No analizado']);
    expect(c.legend[3]).toMatchObject({ count: 3, size: 5020 });
    expect(c.colorOf(usageOf('public/trees.glb'))).not.toBe(c.colorOf(usageOf('public/kart.glb')));
    expect(c.keyOf(usageOf('public/grass.png'))).toBe('mentioned');
  });
});

describe('git (fase 5)', () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 10, 16);
  const commit = (i: number, daysAgo: number): PanelCommit => ({
    hash: `${i}`.repeat(40),
    short: `${i}`.repeat(7),
    author: 'David',
    time: now - daysAgo * DAY,
    subject: `commit ${i}`,
  });
  // 10 commits, del más reciente (0, hoy) al más antiguo (9, hace 900 días).
  const commits = Array.from({ length: 10 }, (_, i) => commit(i, i * 100));
  const gFiles: PanelFile[] = [
    ...commits.map((_, i) => ({ path: `src/f${i}.ts`, size: 100 + i, commit: i })),
    { path: 'src/tocado.ts', size: 10, commit: 0, dirty: true },
    { path: 'src/nuevo.ts', size: 10, dirty: true, untracked: true },
    { path: 'src/viejo.ts', size: 10 },
  ];
  const rows = toRows(gFiles, [], { commits });
  const row = (p: string) => rows.find((r) => r.path === p)!;

  it('cada fila lleva su último commit y su estado', () => {
    expect(row('src/f3.ts').commit).toBe(commits[3]);
    expect(row('src/tocado.ts')).toMatchObject({ dirty: true, untracked: false });
    expect(row('src/nuevo.ts')).toMatchObject({ commit: null, dirty: true, untracked: true });
    expect(row('src/viejo.ts')).toMatchObject({ commit: null, dirty: false });
  });

  it('con el índice a medias no hay datos de git', () => {
    const partial = toRows(gFiles, [], { commits, complete: false });
    expect(partial.every((r) => r.commit === null && !r.dirty && !r.untracked)).toBe(true);
  });

  it('ordenar por Último cambio: lo nuevo primero, lo que no tiene dato al final', () => {
    expect(nextSort(DEFAULT_SORT, 'changed')).toEqual({ key: 'changed', dir: 'desc' });
    const order = sortRows(rows, { key: 'changed', dir: 'desc' }).map((r) => r.path);
    expect(order[0]).toBe('src/nuevo.ts');
    expect(order.slice(1, 3).sort()).toEqual(['src/f0.ts', 'src/tocado.ts']);
    expect(order.at(-2)).toBe('src/f9.ts');
    expect(order.at(-1)).toBe('src/viejo.ts');
  });

  it('filtro «Con cambios sin commit»: modificados y nuevos', () => {
    expect(quickCounts(rows).dirty).toBe(2);
    expect(quickRows(rows, 'dirty').map((r) => r.path)).toEqual(['src/tocado.ts', 'src/nuevo.ts']);
  });

  it('cortes por cuantiles: tramos con los mismos archivos, sin partir valores iguales', () => {
    expect(quantileFloors([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 5)).toEqual([9, 7, 5, 3, 1]);
    expect(quantileFloors([5, 5, 5, 5, 1], 5)).toEqual([5, 1]);
    expect(quantileFloors([7], 5)).toEqual([7]);
    expect(quantileFloors([], 5)).toEqual([]);
  });

  it('un commit que toca casi todo el repo se queda con un tramo, y el resto se reparte los demás', () => {
    // 85 archivos del commit inicial (valor 1) y 15 cambios posteriores, cada uno distinto.
    const values = [...Array.from({ length: 15 }, (_, i) => 100 + i), ...Array.from({ length: 85 }, () => 1)];
    const floors = quantileFloors(values, 5);
    expect(floors).toHaveLength(5);
    expect(floors.at(-1)).toBe(1);
    expect(floors.slice(0, 4).every((f) => f >= 100)).toBe(true);
    // Los 15 recientes, en 4 tramos parecidos.
    const sizes = floors.slice(0, 4).map((f, i) => values.filter((v) => v >= f && (i === 0 || v < floors[i - 1]!)).length);
    expect(sizes).toEqual([4, 4, 4, 3]);
  });

  it('el valor dominante puede estar en medio o ser el más reciente', () => {
    expect(quantileFloors([9, 8, ...Array.from({ length: 20 }, () => 5), 3, 2, 1], 5)).toEqual([9, 8, 5, 2, 1]);
    expect(quantileFloors([...Array.from({ length: 20 }, () => 9), 4, 3, 2, 1], 5)).toEqual([9, 4, 3, 2, 1]);
  });

  it('nunca devuelve más tramos que los pedidos, ni tramos repetidos', () => {
    for (const values of [[5, 5, 4, 4, 3, 3, 2, 2, 1, 1], [3, 3, 3, 2, 2, 2, 1, 1, 1], [9, 9, 9, 9, 5, 1, 1, 1, 1]]) {
      const floors = quantileFloors(values, 3);
      expect(floors.length).toBeLessThanOrEqual(3);
      expect(new Set(floors).size).toBe(floors.length);
      expect(floors.at(-1)).toBe(Math.min(...values));
    }
  });

  it('color «Antigüedad»: 5 tramos por cuantiles del repo, más nuevos y sin dato', () => {
    const c = coloring('age', rows, now);
    expect(c.legend.map((l) => l.count)).toEqual([1, 3, 2, 2, 2, 2, 1]);
    expect(c.legend[0]!.label).toBe('Nuevo (sin commit)');
    expect(c.legend[1]!.label).toBe('hasta hace 3 meses');
    expect(c.legend.at(-1)!.label).toBe('Sin dato de git');
    expect(c.keyOf(row('src/f0.ts'))).toBe('t0');
    expect(c.keyOf(row('src/f9.ts'))).toBe('t4');
    expect(new Set(c.legend.map((l) => l.color)).size).toBe(7);
  });

  it('«Antigüedad» se adapta al repo: si todo es de la última semana, también reparte', () => {
    const recent = Array.from({ length: 10 }, (_, i) => commit(i, i * 0.5));
    const c = coloring('age', toRows(recent.map((_, i) => ({ path: `f${i}`, size: 1, commit: i })), [], { commits: recent }), now);
    expect(c.legend).toHaveLength(5);
  });

  it('color «Commits recientes»: solo los últimos 8; mismo commit, mismo color', () => {
    const c = coloring('recent', rows);
    expect(c.legend.map((l) => l.label)).toEqual([
      'Nuevo (sin commit)',
      ...commits.slice(0, 8).map((k) => `${k.short} ${k.subject}`),
      'Anteriores',
    ]);
    expect(c.colorOf(row('src/f0.ts'))).toBe(c.colorOf(row('src/tocado.ts')));
    expect(c.colorOf(row('src/f0.ts'))).not.toBe(c.colorOf(row('src/f1.ts')));
    expect(c.colorOf(row('src/f8.ts'))).toBe(c.colorOf(row('src/f9.ts')));
    expect(c.legend.at(-1)).toMatchObject({ count: 3 });
  });
});

describe('hotspots (fase 6)', () => {
  const hFiles: PanelFile[] = [
    { path: 'src/index.css', size: 40_000, lines: 1746, changes: 19 },
    { path: 'src/store.ts', size: 20_000, lines: 681, changes: 17 },
    { path: 'src/util.ts', size: 2_000, lines: 60, changes: 2 },
    { path: 'src/estable.ts', size: 30_000, lines: 900, changes: 1 },
    { path: 'src/nuevo.ts', size: 500, lines: 20 },
    { path: 'package-lock.json', size: 118_000, lines: 3562, changes: 40, generated: true },
    { path: 'public/kart.glb', size: 4_000_000, changes: 3 },
  ];
  const rows = toRows(hFiles, []);
  const row = (p: string) => rows.find((r) => r.path === p)!;

  it('líneas y cambios en cada fila; los binarios no tienen líneas', () => {
    expect(row('src/index.css')).toMatchObject({ lines: 1746, changes: 19, generated: false });
    expect(row('public/kart.glb')).toMatchObject({ lines: null, changes: 3 });
    expect(row('src/nuevo.ts').changes).toBe(0);
    expect(row('package-lock.json').generated).toBe(true);
  });

  it('con el índice a medias hay líneas pero aún no cambios', () => {
    const partial = toRows(hFiles, [], { complete: false });
    expect(partial[0]).toMatchObject({ lines: 1746, changes: 0 });
  });

  it('ordenar por Líneas y por Cambios empieza por lo grande; los binarios, al final', () => {
    expect(nextSort(DEFAULT_SORT, 'lines')).toEqual({ key: 'lines', dir: 'desc' });
    expect(nextSort(DEFAULT_SORT, 'changes')).toEqual({ key: 'changes', dir: 'desc' });
    const byLines = sortRows(rows, { key: 'lines', dir: 'desc' }).map((r) => r.path);
    expect(byLines[0]).toBe('package-lock.json');
    expect(byLines.at(-1)).toBe('public/kart.glb');
    expect(sortRows(rows, { key: 'changes', dir: 'desc' }).map((r) => r.changes)).toEqual([40, 19, 17, 3, 2, 1, 0]);
  });

  it('área «Líneas»: solo texto, proporcional a las líneas', async () => {
    const { layoutTreemap, areaValue } = await import('../src/webview/treemap-layout.js');
    expect(areaValue(row('src/index.css'), 'lines')).toBe(1746);
    expect(areaValue(row('public/kart.glb'), 'lines')).toBe(0);
    const cells = layoutTreemap(rows, { width: 800, height: 600, area: 'lines', zoom: '' });
    expect(cells.some((c) => c.path === 'public/kart.glb')).toBe(false);
    const css = cells.find((c) => c.path === 'src/index.css')!;
    const store = cells.find((c) => c.path === 'src/store.ts')!;
    expect((css.w * css.h) / (store.w * store.h)).toBeGreaterThan(2);
    // Las carpetas suman las líneas de lo dibujado.
    expect(cells.find((c) => c.kind === 'dir' && c.path === 'src')!.lines).toBe(1746 + 681 + 60 + 900 + 20);
  });

  it('color «Cambios»: tramos por cuantiles; lockfiles y generados quedan fuera', () => {
    const c = coloring('changes', rows);
    expect(c.keyOf(row('package-lock.json'))).toBe('generado');
    expect(c.keyOf(row('src/nuevo.ts'))).toBe('estable');
    // El lockfile (40 cambios) no entra en el cálculo: el tramo más intenso empieza en 19.
    expect(c.legend[0]!.label).toBe('19 o más cambios');
    expect(c.keyOf(row('src/index.css'))).toBe('c0');
    expect(c.keyOf(row('src/estable.ts'))).toBe(`c${c.legend.filter((l) => l.key.startsWith('c')).length - 1}`);
    expect(c.legend.map((l) => l.label).slice(-2)).toEqual(['Sin cambios registrados', 'Generado o lockfile']);
    expect(c.colorOf(row('src/index.css'))).not.toBe(c.colorOf(row('src/estable.ts')));
  });

  it('etiquetas de los tramos de cambios: rangos sin huecos', () => {
    const many = toRows(Array.from({ length: 50 }, (_, i) => ({ path: `f${i}.ts`, size: 1, lines: 1, changes: i + 1 })), []);
    expect(coloring('changes', many).legend.map((l) => l.label)).toEqual(['41 o más cambios', '31–40', '21–30', '11–20', '1–10']);
  });
});
