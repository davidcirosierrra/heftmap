import { describe, expect, it } from 'vitest';
import { coloring, textOn } from '../src/webview/colors.js';
import { toRows } from '../src/webview/model.js';
import { areaValue, crumbs, effectiveZoom, fitText, layoutTreemap, type Cell } from '../src/webview/treemap-layout.js';
import { i18n } from '../src/i18n/index.js';

const ES = i18n('es');

const rows = toRows(
  [
    { path: 'public/models/circuit.glb', size: 8_400_000 },
    { path: 'public/models/kart.glb', size: 4_100_000 },
    { path: 'public/audio/music.mp3', size: 2_000_000 },
    { path: 'src/game/Physics.ts', size: 9000 },
    { path: 'src/game/Track.ts', size: 4000 },
    { path: 'src/main.tsx', size: 400 },
    { path: 'index.html', size: 300 },
    { path: 'vacio.txt', size: 0 },
  ],
  [],
);
const layout = (o: Partial<Parameters<typeof layoutTreemap>[1]> = {}): Cell[] =>
  layoutTreemap(rows, { width: 800, height: 600, area: 'bytes', zoom: '', ...o });
const area = (c: Cell): number => c.w * c.h;
const file = (cells: Cell[], path: string): Cell => {
  const c = cells.find((x) => x.kind === 'file' && x.path === path);
  if (!c) throw new Error(`no se dibuja ${path}`);
  return c;
};
const inside = (a: Cell, b: Cell): boolean => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

describe('treemap: disposición', () => {
  it('área proporcional a los bytes; un archivo vacío no se dibuja', () => {
    const cells = layout();
    const ratio = area(file(cells, 'public/models/circuit.glb')) / area(file(cells, 'public/models/kart.glb'));
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.4);
    expect(cells.some((c) => c.path === 'vacio.txt')).toBe(false);
  });

  it('anidado: cada archivo cae dentro de su carpeta, bajo la cabecera', () => {
    const cells = layout();
    const models = cells.find((c) => c.kind === 'dir' && c.path === 'public/models')!;
    const circuit = file(cells, 'public/models/circuit.glb');
    expect(models.header).toBe(true);
    expect(models.size).toBe(12_500_000);
    expect(models.count).toBe(2);
    expect(inside(circuit, models)).toBe(true);
    expect(circuit.y).toBeGreaterThanOrEqual(models.y + 18);
  });

  it('nada se sale del lienzo', () => {
    for (const c of layout()) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(800);
      expect(c.y + c.h).toBeLessThanOrEqual(600);
    }
  });

  it('en Bytes el código no llega a verse junto a los binarios; en Equilibrado sí', () => {
    // 9 KB frente a 14,5 MB: menos de un píxel, no se dibuja.
    expect(layout().some((c) => c.path === 'src/game/Physics.ts')).toBe(false);
    const balanced = layout({ area: 'balanced' });
    expect(area(file(balanced, 'src/game/Physics.ts')) / (800 * 600)).toBeGreaterThan(0.005);
    expect(areaValue(rows[0]!, 'balanced')).toBeCloseTo(Math.sqrt(8_400_000));
    // El tamaño que se enseña sigue siendo el real.
    expect(file(balanced, 'src/game/Physics.ts').size).toBe(9000);
  });

  it('una carpeta pequeña no lleva cabecera', () => {
    const game = layout({ area: 'balanced' }).find((c) => c.kind === 'dir' && c.path === 'src/game')!;
    expect(game.w < 44 || game.h < 34).toBe(true);
    expect(game.header).toBe(false);
  });

  it('lienzo sin tamaño o sin archivos: nada', () => {
    expect(layout({ width: 0 })).toEqual([]);
    expect(layoutTreemap([], { width: 800, height: 600, area: 'bytes', zoom: '' })).toEqual([]);
  });
});

describe('treemap: zoom', () => {
  it('ampliar una carpeta dibuja solo lo suyo, a todo el lienzo', () => {
    const cells = layout({ zoom: 'src' });
    expect(cells.filter((c) => c.kind === 'file').map((c) => c.path).sort()).toEqual(['src/game/Physics.ts', 'src/game/Track.ts', 'src/main.tsx']);
    expect(cells.find((c) => c.path === 'src/game')?.header).toBe(true);
    const total = cells.filter((c) => c.kind === 'file').reduce((s, c) => s + area(c), 0);
    expect(total).toBeGreaterThan(800 * 600 * 0.9);
  });

  it('no confunde prefijos de texto con carpetas', () => {
    expect(effectiveZoom(rows, 'src')).toBe('src');
    expect(effectiveZoom(rows, 'sr')).toBe('');
    expect(effectiveZoom(rows, 'src/game')).toBe('src/game');
  });

  it('una carpeta que ya no existe (filtro, ámbito) vuelve a la raíz', () => {
    expect(effectiveZoom(rows, 'borrada')).toBe('');
    expect(layout({ zoom: 'borrada' }).some((c) => c.path === 'public/models/kart.glb')).toBe(true);
  });

  it('migas', () => {
    expect(crumbs('', 'kart')).toEqual([{ path: '', name: 'kart' }]);
    expect(crumbs('src/game', 'kart')).toEqual([
      { path: '', name: 'kart' },
      { path: 'src', name: 'src' },
      { path: 'src/game', name: 'game' },
    ]);
  });
});

describe('treemap: textos y colores', () => {
  it('recorta el texto al ancho', () => {
    expect(fitText('circuit.glb', 200)).toBe('circuit.glb');
    expect(fitText('circuit.glb', 40)).toBe('circu…');
    expect(fitText('circuit.glb', 10)).toBe('');
  });

  it('color por extensión: las que más pesan primero, mismo color para la misma extensión', () => {
    const c = coloring('ext', rows, ES);
    expect(c.legend.map((l) => l.key).slice(0, 2)).toEqual(['.glb', '.mp3']);
    expect(c.legend[0]).toMatchObject({ count: 2, size: 12_500_000 });
    expect(c.colorOf(rows[0]!)).toBe(c.colorOf(rows[1]!));
    expect(c.colorOf(rows[0]!)).not.toBe(c.colorOf(rows[2]!));
    expect(c.keyOf(rows[0]!)).toBe('.glb');
  });

  it('más extensiones que colores: el resto va a «otros»', () => {
    const many = toRows(Array.from({ length: 14 }, (_, i) => ({ path: `f.e${i}`, size: 100 - i })), []);
    const c = coloring('ext', many, ES);
    expect(c.legend).toHaveLength(10);
    expect(c.legend.at(-1)).toMatchObject({ label: 'otros (5)', count: 5 });
    expect(c.keyOf(many[13]!)).toBe('(otros)');
    expect(new Set(c.legend.map((l) => l.color)).size).toBe(10);
  });

  it('texto legible sobre cada color', () => {
    expect(textOn('#edc948')).toBe('#111111');
    expect(textOn('#1f3b5c')).toBe('#ffffff');
  });
});
