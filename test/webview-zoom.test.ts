// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PanelFile, PanelRef } from '../src/extension/panel-protocol.js';
import { inZoom, zoomRows, type Row } from '../src/webview/model.js';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** Zoom enlazado con la tabla (plan, pasos 3.1 y 3.2). */
const files: PanelFile[] = [
  { path: 'README.md', size: 300, usage: 'not-analyzed', lines: 12 },
  { path: 'src/main.tsx', size: 120, usage: 'entry', lines: 5, code: true },
  { path: 'src/game/Kart.ts', size: 900, usage: 'referenced', lines: 40, code: true },
  { path: 'src/game/Track.ts', size: 500, usage: 'referenced', lines: 20, code: true },
];
const refs: PanelRef[] = [[1, 2, 'import']];
let p: Harness;
const names = (): string[] => p.text('.body .row .name');

describe('model: zoom', () => {
  it('inZoom y zoomRows: por carpeta, no por prefijo de texto', () => {
    expect(inZoom('src/game/Kart.ts', 'src/game')).toBe(true);
    expect(inZoom('src/gameplay/x.ts', 'src/game')).toBe(false);
    expect(inZoom('README.md', '')).toBe(true);
    const rows = [{ path: 'src/game/a.ts' }, { path: 'src/b.ts' }] as Row[];
    expect(zoomRows(rows, 'src/game').map((r) => r.path)).toEqual(['src/game/a.ts']);
    expect(zoomRows(rows, '')).toHaveLength(2);
  });
});

describe('panel (DOM): zoom y tabla', () => {
  beforeAll(async () => {
    p = await mountPanel({ zoom: 'src/game', selected: 'src/game/Kart.ts' });
    await p.send(status());
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, isGit: true, files, refs, commits: [] } });
  });

  it('la tabla y los totales enseñan solo lo de la carpeta ampliada, con un chip que lo dice', () => {
    expect(names()).toEqual(['Kart.ts', 'Track.ts']);
    expect(p.text('.totals')[0]).toMatch(/^2 de 4 archivos/);
    expect(p.text('.chip.zoom')[0]).toContain('Zoom: src/game/');
  });

  it('un enlace del detalle a un archivo fuera del zoom sale del zoom y lo selecciona', async () => {
    const link = p.$$('.links button.link').find((b) => b.textContent === 'src/main.tsx');
    await p.click(link);
    expect(p.state).toMatchObject({ zoom: '', selected: 'src/main.tsx' });
    expect(names()).toHaveLength(4);
    expect(p.$('.chip.zoom')).toBeNull();
  });

  it('el ✕ del chip sale del zoom', async () => {
    vi.resetModules();
    p = await mountPanel({ zoom: 'src/game' });
    await p.send(status());
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, isGit: true, files, refs, commits: [] } });
    expect(names()).toHaveLength(2);
    await p.click(p.$('.chip.zoom button'));
    expect(p.state).toMatchObject({ zoom: '' });
    expect(names()).toHaveLength(4);
  });
});
