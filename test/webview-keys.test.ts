// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PanelFile } from '../src/extension/panel-protocol.js';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** Atajos de teclado (plan, paso 3.6). */
const files: PanelFile[] = [
  { path: 'src/game/a.ts', size: 900, usage: 'referenced' },
  { path: 'README.md', size: 300, usage: 'not-analyzed' },
];
let p: Harness;

describe('atajo global', () => {
  it('abrir el panel: Ctrl+Shift+Alt+H (Cmd+Ctrl+Shift+H en Mac), sin acordes de Cmd+K/Cmd+R', () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.contributes.keybindings).toEqual([{ command: 'heftmap.openPanel', key: 'ctrl+shift+alt+h', mac: 'cmd+ctrl+shift+h' }]);
  });
});

describe('panel (DOM): teclado', () => {
  beforeAll(async () => {
    p = await mountPanel({ zoom: 'src/game' });
    await p.send(status());
    await p.send({ type: 'index', index: { rootName: 'r', complete: true, isGit: true, files, refs: [], commits: [] } });
  });

  it('Escape dentro del filtro no sale del zoom', async () => {
    await p.key(p.$('input.filter'), 'Escape');
    expect(p.state).toMatchObject({ zoom: 'src/game' });
  });

  it('Escape fuera de un campo sale del zoom', async () => {
    await p.key(p.root, 'Escape');
    expect(p.state).toMatchObject({ zoom: '' });
  });

  it('«/» enfoca el filtro', async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await p.key(p.root, '/');
    expect(document.activeElement).toBe(p.$('input.filter'));
  });
});
