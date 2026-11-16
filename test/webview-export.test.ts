// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { PanelFile } from '../src/extension/panel-protocol.js';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** Botón «Copiar tabla» del panel (plan, paso 3.5): manda las filas que se ven, en su orden. */
const files: PanelFile[] = [
  { path: 'src/b.ts', size: 100, usage: 'referenced' },
  { path: 'src/a.ts', size: 900, usage: 'referenced' },
  { path: 'README.md', size: 300, usage: 'not-analyzed' },
];
let p: Harness;
const exported = () => p.sent.filter((m) => m.type === 'exportTable').at(-1);

describe('panel (DOM): copiar tabla', () => {
  beforeAll(async () => {
    p = await mountPanel({ sort: { key: 'size', dir: 'desc' } });
    await p.send(status());
    await p.send({ type: 'index', index: { rootName: 'r', complete: true, isGit: true, files, refs: [], commits: [] } });
  });

  it('el botón manda las filas visibles en el orden de la tabla', async () => {
    await p.click(p.$('button.export'));
    expect(exported()).toEqual({ type: 'exportTable', paths: ['src/a.ts', 'README.md', 'src/b.ts'] });
  });

  it('con un filtro, solo lo que se ve; el comando (requestExport) hace lo mismo', async () => {
    await p.type(p.$('input.filter'), 'src');
    await p.send({ type: 'requestExport' });
    expect(exported()).toEqual({ type: 'exportTable', paths: ['src/a.ts', 'src/b.ts'] });
  });
});
