// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { PanelFile } from '../src/extension/panel-protocol.js';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** La leyenda filtra la tabla (plan, paso 3.4: el clic filtra siempre). */
const files: PanelFile[] = [
  { path: 'src/a.ts', size: 900, usage: 'referenced', lines: 10, code: true },
  { path: 'src/b.ts', size: 500, usage: 'referenced', lines: 10, code: true },
  { path: 'public/x.png', size: 4000, usage: 'none' },
  { path: 'README.md', size: 300, usage: 'not-analyzed' },
];
let p: Harness;
const names = (): string[] => p.text('.body .row .name').sort();
const legend = (label: string) => p.$$('.legend .leg').find((b) => b.textContent?.includes(label));

describe('panel (DOM): la leyenda filtra la tabla', () => {
  beforeAll(async () => {
    p = await mountPanel({ color: 'ext' });
    await p.send(status());
    await p.send({ type: 'index', index: { rootName: 'r', complete: true, isGit: true, files, refs: [], commits: [] } });
  });

  it('clic en un grupo: la tabla y los totales se quedan con ese grupo, con un chip', async () => {
    expect(names()).toHaveLength(4);
    await p.click(legend('.ts'));
    expect(names()).toEqual(['a.ts', 'b.ts']);
    expect(p.text('.totals')[0]).toMatch(/^2 de 4 archivos/);
    expect(p.text('.chip.group')[0]).toContain('.ts');
    expect(legend('.ts')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('otro clic en el mismo grupo lo enseña todo; el ✕ del chip también', async () => {
    await p.click(legend('.ts'));
    expect(names()).toHaveLength(4);
    expect(p.$('.chip.group')).toBeNull();
    await p.click(legend('.png'));
    expect(names()).toEqual(['x.png']);
    await p.click(p.$('.chip.group button'));
    expect(names()).toHaveLength(4);
  });

  it('cambiar el modo de color quita el grupo si ya no existe', async () => {
    await p.click(legend('.png'));
    const [, color] = p.$$('.tm-bar select');
    await p.choose(color, 'usage');
    expect(names()).toHaveLength(4);
    expect(p.$('.chip.group')).toBeNull();
  });
});
