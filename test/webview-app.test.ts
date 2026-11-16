// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** El panel de verdad (React) en jsdom: lo que la lógica pura de `model.ts` no cubre. */
const files = [
  { path: 'README.md', size: 300 },
  { path: 'src/main.tsx', size: 120 },
  { path: 'src/game/Kart.ts', size: 900 },
  { path: 'public/models/kart.glb', size: 4_000_000 },
];
let p: Harness;
const names = (): string[] => p.text('.body .row .name');

beforeAll(async () => {
  p = await mountPanel();
});

describe('panel (DOM): tabla', () => {
  it('avisa «ready» y espera', () => {
    expect(p.sent).toEqual([{ type: 'ready' }]);
    expect(p.$('.splash')).toBeTruthy();
  });

  it('pinta la tabla al recibir el índice', async () => {
    await p.send(status());
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, files } });
    expect(names()).toEqual(['kart.glb', 'Kart.ts', 'main.tsx', 'README.md']);
  });

  it('ordenar por una cabecera no vacía el panel (regresión: setState dentro de useEffect)', async () => {
    await p.click(p.$('.head .cell.size'));
    expect(names()).toEqual(['kart.glb', 'Kart.ts', 'README.md', 'main.tsx']);
    await p.click(p.$('.head .cell.size'));
    expect(names()[0]).toBe('main.tsx');
    await p.click(p.$('.head .cell.name'));
    expect(names()[0]).toBe('kart.glb');
  });

  it('filtrar y seleccionar tampoco', async () => {
    await p.type(p.$('.filter'), 'kart');
    expect(names()).toEqual(['kart.glb', 'Kart.ts']);
    await p.click(p.$$('.body .row')[1]);
    expect(p.$('.row.selected .name')?.textContent).toBe('Kart.ts');
    await p.type(p.$('.filter'), '');
    expect(names()).toHaveLength(4);
  });

  it('guarda orden, filtro y selección', () => {
    expect(p.state).toMatchObject({ sort: { key: 'name', dir: 'asc' }, filter: '', selected: 'src/game/Kart.ts' });
  });

  it('Enter abre el archivo seleccionado', async () => {
    await p.key(p.$('.body'), 'Enter');
    expect(p.sent.at(-1)).toEqual({ type: 'open', path: 'src/game/Kart.ts' });
  });
});
