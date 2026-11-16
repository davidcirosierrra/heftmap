// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** El panel de verdad (React) en jsdom: lo que la lógica pura de `model.ts` no cubre. */
const files = [
  { path: 'README.md', size: 300 },
  { path: 'src/main.tsx', size: 120 },
  { path: 'src/game/Kart.ts', size: 900 },
  { path: 'public/models/kart.glb', size: 4000 },
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
