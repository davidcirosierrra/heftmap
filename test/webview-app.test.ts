// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { PanelFile, PanelRef } from '../src/extension/panel-protocol.js';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** El panel de verdad (React) en jsdom: lo que la lógica pura de `model.ts` no cubre. */
const files: PanelFile[] = [
  { path: 'README.md', size: 300, usage: 'not-analyzed' },
  { path: 'src/main.tsx', size: 120, usage: 'entry' },
  { path: 'src/game/Kart.ts', size: 900, usage: 'referenced' },
  { path: 'public/models/kart.glb', size: 4000, usage: 'none' },
];
const refs: PanelRef[] = [[1, 2, 'import']];
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
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, files, refs } });
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

  it('las flechas mueven la selección', async () => {
    await p.key(p.$('.body'), 'ArrowDown');
    expect(p.$('.row.selected .name')?.textContent).toBe('main.tsx');
    await p.key(p.$('.body'), 'Home');
    expect(p.$('.row.selected .name')?.textContent).toBe('kart.glb');
  });
});

describe('panel (DOM): treemap y detalle', () => {
  const fileCell = (name: string) => p.$$('.tm-file').find((g) => g.querySelector('title')?.textContent?.includes(name));

  it('dibuja un rectángulo por archivo y cabeceras de carpeta', () => {
    expect(p.$$('.tm-file')).toHaveLength(4);
    expect(p.$('.tm-dir title')?.textContent).toContain('public/');
    expect(p.text('.crumbs .here')).toEqual(['kart']);
  });

  it('clic en el treemap selecciona en la tabla y rellena el detalle', async () => {
    await p.click(fileCell('README.md'));
    expect(p.$('.row.selected .name')?.textContent).toBe('README.md');
    expect(p.$('.d-path')?.textContent).toBe('README.md');
    expect(p.$('.d-meta')?.textContent).toContain('300 B');
    expect(p.$('.tm-selected')).toBeTruthy();
  });

  it('doble clic abre; los botones del detalle abren y revelan', async () => {
    await p.dblclick(fileCell('README.md'));
    expect(p.sent.at(-1)).toEqual({ type: 'open', path: 'README.md' });
    await p.click(p.$$('.d-actions button')[1]);
    expect(p.sent.at(-1)).toEqual({ type: 'reveal', path: 'README.md' });
  });

  it('clic en la cabecera de una carpeta amplía; las migas vuelven', async () => {
    await p.click(p.$$('.tm-dir').find((g) => g.querySelector('title')?.textContent?.startsWith('public/ ')));
    expect(p.$$('.tm-file')).toHaveLength(1);
    expect(p.text('.crumbs .here')).toEqual(['public']);
    expect(p.state).toMatchObject({ zoom: 'public' });
    await p.click(p.$('.crumbs .link'));
    expect(p.$$('.tm-file')).toHaveLength(4);
  });

  it('el filtro de texto también recorta el treemap', async () => {
    await p.type(p.$('.filter'), 'src');
    expect(p.$$('.tm-file')).toHaveLength(2);
    await p.type(p.$('.filter'), '');
  });

  it('la leyenda resalta un grupo y atenúa el resto', async () => {
    const glb = p.$$('.leg').find((b) => b.textContent === '.glb');
    await p.click(glb);
    expect(p.$$('.tm-file.dim')).toHaveLength(3);
    await p.click(glb);
    expect(p.$$('.tm-file.dim')).toHaveLength(0);
  });

  it('cambiar el área a Equilibrado se guarda y no rompe nada', async () => {
    await p.choose(p.$$('.select select')[0], 'balanced');
    expect(p.state).toMatchObject({ area: 'balanced' });
    expect(p.$$('.tm-file')).toHaveLength(4);
  });
});

describe('panel (DOM): uso', () => {
  const pill = (label: string) => p.$$('.pill').find((b) => b.textContent?.startsWith(label));
  const selectRow = (name: string) => p.click(p.$$('.body .row').find((r) => r.querySelector('.name')?.textContent === name));

  it('columna Uso con estado y nº de referencias', () => {
    const cells = Object.fromEntries(p.$$('.body .row').map((r) => [r.querySelector('.name')!.textContent, r.querySelector('.cell.usage')!.textContent]));
    expect(cells).toEqual({ 'kart.glb': 'Sin rastro', 'Kart.ts': 'Referenciado · 1', 'main.tsx': 'Punto de entrada', 'README.md': 'No analizado' });
  });

  it('filtros rápidos con recuento; recortan tabla y treemap', async () => {
    expect(p.text('.pill')).toEqual(['Todos', 'Sin rastro1', 'Mencionados0', 'Puntos de entrada1']);
    await p.click(pill('Sin rastro'));
    expect(names()).toEqual(['kart.glb']);
    expect(p.$$('.tm-file')).toHaveLength(1);
    expect(p.$('.totals')?.textContent).toMatch(/^1 de 4 archivos/);
    await p.click(pill('Todos'));
    expect(names()).toHaveLength(4);
  });

  it('detalle de un archivo sin rastro: aviso y acciones, que piden permiso a la extensión', async () => {
    await selectRow('kart.glb');
    expect(p.$('.d-state')?.textContent).toBe('Sin rastro');
    const actions = p.$$('.d-usage button');
    expect(actions.map((b) => b.textContent)).toEqual(['Ignorar este archivo', 'Mover a la papelera…']);
    await p.click(actions[0]);
    expect(p.sent.at(-1)).toEqual({ type: 'ignoreUsage', path: 'public/models/kart.glb' });
    await p.click(actions[1]);
    expect(p.sent.at(-1)).toEqual({ type: 'trash', path: 'public/models/kart.glb' });
  });

  it('las acciones solo salen en «sin rastro»', async () => {
    await selectRow('Kart.ts');
    expect(p.$$('.d-usage button')).toHaveLength(0);
  });

  it('«Lo usan» y «Usa»: clic en una referencia la selecciona', async () => {
    expect(p.text('.links h2')).toEqual(['Lo usan 1', 'Usa 0']);
    expect(p.text('.links li')).toEqual(['src/main.tsximport']);
    await p.click(p.$('.links li .link'));
    expect(p.$('.d-path')?.textContent).toBe('src/main.tsx');
    expect(p.text('.links li')).toEqual(['src/game/Kart.tsimport']);
  });

  it('con ámbito, una referencia de fuera sale marcada y se abre en vez de seleccionarse', async () => {
    await p.send(status({ scope: ['src/game'] }));
    await selectRow('Kart.ts');
    expect(p.$('.links .outside')?.textContent).toBe('fuera del ámbito');
    await p.click(p.$('.links li .link'));
    expect(p.sent.at(-1)).toEqual({ type: 'open', path: 'src/main.tsx' });
    expect(p.$('.d-path')?.textContent).toBe('src/game/Kart.ts');
    await p.send(status());
  });

  it('color «Uso»: leyenda por estados', async () => {
    await p.choose(p.$$('.select select')[1], 'usage');
    expect(p.text('.leg')).toEqual(['Sin rastro', 'Referenciado', 'Punto de entrada', 'No analizado']);
  });

  it('con el índice a medias: uso pendiente y filtros rápidos apagados', async () => {
    await p.send({ type: 'index', index: { rootName: 'kart', complete: false, files, refs: [] } });
    expect(new Set(p.text('.body .row .cell.usage'))).toEqual(new Set(['Analizando…']));
    expect(pill('Sin rastro')?.hasAttribute('disabled')).toBe(true);
    expect(pill('Todos')?.hasAttribute('disabled')).toBe(false);
  });
});
