// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { PanelCommit, PanelFile, PanelRef } from '../src/extension/panel-protocol.js';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** El panel de verdad (React) en jsdom: lo que la lógica pura de `model.ts` no cubre. */
const commits: PanelCommit[] = [
  { hash: 'e41d0b7' + 'a'.repeat(33), short: 'e41d0b7', author: 'David', time: Date.now() - 3 * 86_400_000, subject: 'Añade el kart' },
];
const files: PanelFile[] = [
  { path: 'README.md', size: 300, usage: 'not-analyzed', commit: 0, lines: 12, changes: 1 },
  { path: 'src/main.tsx', size: 120, usage: 'entry', dirty: true, untracked: true, lines: 5 },
  { path: 'src/game/Kart.ts', size: 900, usage: 'referenced', commit: 0, dirty: true, lines: 1746, changes: 19 },
  { path: 'public/models/kart.glb', size: 4000, usage: 'none', commit: 0, changes: 2 },
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
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, isGit: true, files, refs, commits } });
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
    expect(p.text('.pill')).toEqual(['Todos', 'Sin rastro1', 'Mencionados0', 'Puntos de entrada1', 'Con cambios sin commit2', 'Hotspots', 'Ocultar gráfico']);
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

  it('columna Último cambio: fecha y hash, ● con cambios, «nuevo» sin commits', () => {
    const cells = Object.fromEntries(p.$$('.body .row').map((r) => [r.querySelector('.name')!.textContent, r.querySelector('.cell.changed')!.textContent]));
    expect(cells).toEqual({ 'kart.glb': 'hace 3 d e41d0b7', 'Kart.ts': 'hace 3 d e41d0b7 ●', 'main.tsx': 'nuevo', 'README.md': 'hace 3 d e41d0b7' });
  });

  it('detalle del commit: clic en el hash copia el completo; «Ver diff» solo con cambios', async () => {
    await selectRow('Kart.ts');
    expect(p.$('.d-subject')?.textContent).toBe('Añade el kart');
    expect(p.$('.d-commit .d-meta')?.textContent).toMatch(/^David · hace 3 d \(/);
    await p.click(p.$('.d-commit .hash'));
    expect(p.sent.at(-1)).toEqual({ type: 'copy', text: commits[0]!.hash });
    expect(p.$('.copied')?.textContent).toBe('copiado');
    await p.click(p.$$('.d-commit button').find((b) => b.textContent === 'Ver diff'));
    expect(p.sent.at(-1)).toEqual({ type: 'diff', path: 'src/game/Kart.ts' });
    await selectRow('kart.glb');
    expect(p.$$('.d-commit button').map((b) => b.textContent)).toEqual(['e41d0b7']);
    await selectRow('main.tsx');
    expect(p.$('.d-commit')?.textContent).toContain('todavía sin commits');
  });

  it('filtro «Con cambios sin commit» y colores de git', async () => {
    await p.click(pill('Con cambios sin commit'));
    expect(names()).toEqual(['Kart.ts', 'main.tsx']);
    await p.click(pill('Todos'));
    await p.choose(p.$$('.select select')[1], 'recent');
    expect(p.text('.leg')).toEqual(['Nuevo (sin commit)', 'e41d0b7 Añade el kart']);
    await p.choose(p.$$('.select select')[1], 'age');
    expect(p.text('.leg')).toEqual(['Nuevo (sin commit)', 'hoy – hace 3 d']);
  });

  it('columnas Líneas y Cambios: vacías en binarios y en archivos sin commits', () => {
    const cell = (name: string, col: string) => p.$$('.body .row').find((r) => r.querySelector('.name')?.textContent === name)!.querySelector(`.cell.${col}`)!.textContent;
    expect([cell('Kart.ts', 'lines'), cell('Kart.ts', 'changes')]).toEqual(['1746', '19']);
    expect([cell('kart.glb', 'lines'), cell('kart.glb', 'changes')]).toEqual(['', '2']);
    expect([cell('main.tsx', 'lines'), cell('main.tsx', 'changes')]).toEqual(['5', '']);
  });

  it('atajo «Hotspots»: área Líneas, color Cambios y tabla por Cambios', async () => {
    const hot = pill('Hotspots')!;
    expect(hot.getAttribute('aria-pressed')).toBe('false');
    await p.click(hot);
    expect(p.state).toMatchObject({ area: 'lines', color: 'changes', sort: { key: 'changes', dir: 'desc' } });
    expect(names()).toEqual(['Kart.ts', 'kart.glb', 'README.md', 'main.tsx']);
    // En «Líneas» el binario no se dibuja.
    expect(p.$$('.tm-file')).toHaveLength(3);
    expect(p.text('.leg')).toEqual(['19 o más cambios', '2–18', '1 cambio', 'Sin cambios registrados']);
    expect(pill('Hotspots')!.getAttribute('aria-pressed')).toBe('true');
    expect(p.$('.tm-dir title')?.textContent).toContain('líneas');
    await p.click(p.$('.head .cell.lines'));
    expect(pill('Hotspots')!.getAttribute('aria-pressed')).toBe('false');
    expect(names()[0]).toBe('Kart.ts');
  });

  it('el detalle lleva líneas y cambios', async () => {
    await selectRow('Kart.ts');
    expect(p.$('.d-main .d-meta')?.textContent).toMatch(/1746 líneas · 19 cambios$/);
  });

  it('sin git: hotspots y colores de git apagados; el área Líneas sigue', async () => {
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, isGit: false, files: files.map(({ path, size, lines }) => ({ path, size, lines })), refs: [] } });
    expect(pill('Hotspots')?.hasAttribute('disabled')).toBe(true);
    const options = [...p.$$('.select select')[1]!.querySelectorAll('option')].filter((o) => o.disabled).map((o) => o.textContent);
    expect(options).toEqual(['Antigüedad', 'Commits recientes', 'Cambios']);
    expect(p.$$('.tm-file')).toHaveLength(3);
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, isGit: true, files, refs, commits } });
  });

  it('con el índice a medias: uso pendiente y filtros rápidos apagados', async () => {
    await p.send({ type: 'index', index: { rootName: 'kart', complete: false, files, refs: [] } });
    expect(new Set(p.text('.body .row .cell.usage'))).toEqual(new Set(['Analizando…']));
    expect(pill('Sin rastro')?.hasAttribute('disabled')).toBe(true);
    expect(pill('Todos')?.hasAttribute('disabled')).toBe(false);
  });
});

describe('panel (DOM): divisor, gráfico y línea de estado', () => {
  const pill = (label: string) => p.$$('.pill').find((b) => b.textContent?.startsWith(label));
  const split = () => p.$('.main')!.style.getPropertyValue('--split');

  it('la línea de estado está siempre, con la hora de la última actualización', async () => {
    const at = new Date(2026, 10, 16, 10, 3, 9).getTime();
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, isGit: true, files, refs, commits, updatedAt: at } });
    expect(p.$('.statusline')?.textContent).toBe('Última actualización: 10:03:09');
    expect(p.$('.statusline .spinner')).toBeNull();
  });

  it('al analizar cambia el texto, no aparece ni desaparece ninguna línea', async () => {
    await p.send(status({ building: true, progress: 'uso 12/30' }));
    expect(p.$$('.statusline')).toHaveLength(1);
    expect(p.$('.statusline')?.textContent).toBe('Actualizando: uso 12/30');
    expect(p.$('.statusline .spinner')).toBeTruthy();
    await p.send(status({ error: 'se rompió' }));
    expect(p.$('.statusline')?.textContent).toBe('No se pudo analizar el repositorio: se rompió');
    expect(p.$('.statusline')?.className).toContain('failed');
    await p.send(status());
    expect(p.$$('.statusline')).toHaveLength(1);
  });

  it('divisor entre tabla y gráfico: flechas, límites y vuelta al reparto inicial', async () => {
    const bar = p.$('.splitter')!;
    expect(bar.getAttribute('role')).toBe('separator');
    expect(split()).toBe('60.00%');
    await p.key(bar, 'ArrowLeft');
    expect(split()).toBe('58.00%');
    expect(p.state).toMatchObject({ split: 0.58 });
    for (let i = 0; i < 40; i++) await p.key(bar, 'ArrowRight');
    expect(split()).toBe('85.00%');
    for (let i = 0; i < 60; i++) await p.key(bar, 'ArrowLeft');
    expect(split()).toBe('20.00%');
    await p.dblclick(bar);
    expect(split()).toBe('60.00%');
  });

  it('«Ocultar gráfico» quita treemap y divisor; la tabla sigue; se guarda', async () => {
    await p.click(pill('Ocultar gráfico'));
    expect(p.$('.tm-pane')).toBeNull();
    expect(p.$('.splitter')).toBeNull();
    expect(p.$('.main')?.className).toContain('no-chart');
    expect(names()).toHaveLength(4);
    expect(p.state).toMatchObject({ chart: false });
    await p.click(pill('Mostrar gráfico'));
    expect(p.$('.tm-pane')).toBeTruthy();
  });

  it('«Hotspots» vuelve a mostrar el gráfico si estaba oculto', async () => {
    await p.click(pill('Ocultar gráfico'));
    await p.click(pill('Hotspots'));
    expect(p.$('.tm-pane')).toBeTruthy();
  });
});
