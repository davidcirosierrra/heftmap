import { describe, expect, it } from 'vitest';
import { coloring } from '../src/webview/colors.js';
import { DEFAULT_SORT, filterRows, linksOf, nextSort, quickCounts, quickRows, sortRows, toRows, totalSize, visibleRange } from '../src/webview/model.js';
import type { PanelFile, PanelRef } from '../src/extension/panel-protocol.js';

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
    expect(quickCounts(partial)).toEqual({ all: 8, none: 0, mentioned: 0, entry: 0 });
  });

  it('filtros rápidos y sus recuentos', () => {
    expect(quickCounts(all)).toEqual({ all: 8, none: 1, mentioned: 1, entry: 1 });
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
