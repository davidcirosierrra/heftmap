// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { PanelFile } from '../src/extension/panel-protocol.js';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** El panel en inglés y en euskera, y el cambio de idioma en caliente. */
const files: PanelFile[] = [
  { path: 'src/game/Kart.ts', size: 900, usage: 'referenced', lines: 1746, changes: 19 },
  { path: 'public/models/kart.glb', size: 4000, usage: 'none', changes: 2 },
];
let p: Harness;

beforeAll(async () => {
  p = await mountPanel(undefined, 'en');
});

describe('panel (DOM): idiomas', () => {
  it('arranca en el idioma de la página, antes de recibir nada', () => {
    expect(p.$('.splash h1')?.textContent).toBe('Loading…');
  });

  it('en inglés: cabeceras, filtros, uso y formatos', async () => {
    await p.send(status({ locale: 'en' }));
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, isGit: true, files, refs: [], commits: [] } });
    expect(p.text('.head .cell').map((t) => t.replace(/[▲▼]/, ''))).toEqual(['Name', 'Folder', 'Size', 'Lines', 'Changes', 'Usage', 'Last change']);
    expect(p.text('.pill')[1]).toBe('No trace1');
    expect(p.$('.chip')?.textContent).toBe('Whole repository');
    expect(p.$('.totals')?.textContent).toBe('2 files · 5 KB');
    expect(p.text('.body .row .cell.lines')).toContain('1,746');
  });

  it('cambia a euskera en caliente al llegar otro idioma en el estado', async () => {
    await p.send(status({ locale: 'eu' }));
    expect(p.text('.head .cell').map((t) => t.replace(/[▲▼]/, ''))).toEqual(['Izena', 'Karpeta', 'Tamaina', 'Lerroak', 'Aldaketak', 'Erabilera', 'Azken aldaketa']);
    expect(p.$('.chip')?.textContent).toBe('Biltegi osoa');
    expect(p.$('.totals')?.textContent).toBe('2 fitxategi · 5 KB');
    expect(p.text('.pill')[1]).toBe('Arrastorik gabe1');
    expect(document.documentElement.lang).toBe('eu');
    // La leyenda (calculada) también cambia.
    await p.choose(p.$$('.select select')[1], 'usage');
    expect(p.text('.leg')).toEqual(['Arrastorik gabe', 'Erreferentziatua']);
  });

  it('un idioma desconocido no cambia nada', async () => {
    await p.send(status({ locale: 'fr' as never }));
    expect(p.$('.chip')?.textContent).toBe('Biltegi osoa');
  });
});
