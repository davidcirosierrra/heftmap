import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, filterRows, nextSort, sortRows, toRows, totalSize, visibleRange } from '../src/webview/model.js';

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
    expect(rows[0]).toEqual({ path: 'README.md', name: 'README.md', folder: '', ext: '.md', size: 300 });
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
