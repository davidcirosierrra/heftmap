// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { PanelFile } from '../src/extension/panel-protocol.js';
import { mountPanel, status } from './webview-harness.js';

/** `heftmap.panel.defaultArea` y `defaultColor` (plan, pasos 2.7 y 2.8): solo sin estado guardado. */
const files: PanelFile[] = [{ path: 'src/a.ts', size: 100, usage: 'referenced', lines: 10, code: true }];
const index = { type: 'index' as const, index: { rootName: 'r', complete: true, isGit: true, files, refs: [], commits: [] } };
const defaults = { area: 'lines', color: 'usage' } as const;

describe('área y color por defecto del panel', () => {
  it('sin estado guardado se usan los de los ajustes, y solo la primera vez', async () => {
    vi.resetModules();
    const p = await mountPanel();
    await p.send(status({ defaults }));
    await p.send(index);
    expect(p.state).toMatchObject({ area: 'lines', color: 'usage' });
    // Lo que elige el usuario después manda, aunque lleguen más estados.
    const [area] = p.$$('.tm-bar select');
    await p.choose(area, 'bytes');
    await p.send(status({ defaults }));
    expect(p.state).toMatchObject({ area: 'bytes', color: 'usage' });
  });

  it('con estado guardado se respeta lo guardado; lo que falta toma el de los ajustes', async () => {
    vi.resetModules();
    const p = await mountPanel({ area: 'balanced' });
    await p.send(status({ defaults }));
    await p.send(index);
    expect(p.state).toMatchObject({ area: 'balanced', color: 'usage' });
  });

  it('un valor guardado que no es válido cuenta como no guardado', async () => {
    vi.resetModules();
    const p = await mountPanel({ area: 'pies', color: 'ext' });
    await p.send(status({ defaults }));
    expect(p.state).toMatchObject({ area: 'lines', color: 'ext' });
  });
});
