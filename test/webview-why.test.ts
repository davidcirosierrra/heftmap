// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { PanelFile } from '../src/extension/panel-protocol.js';
import { toRows } from '../src/webview/model.js';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** El «por qué» del veredicto de uso en el detalle (plan, paso 3.3). */
const files: PanelFile[] = [
  { path: 'index.html', size: 300, usage: 'entry', usageRule: 'entry-convention' },
  { path: 'public/a.png', size: 900, usage: 'none', usageRule: 'no-refs' },
  { path: 'public/b.png', size: 500, usage: 'mentioned', usageRule: 'weak-ref' },
  { path: 'old.png', size: 100, usage: 'none' },
];
let p: Harness;
const select = async (name: string): Promise<void> => {
  await p.click(p.$$('.body .row').find((r) => r.querySelector('.name')?.textContent === name));
};
const why = (): string | undefined => p.text('.d-why')[0];
const hint = (): string | undefined => p.text('.d-hint')[0];

describe('model: regla en las filas', () => {
  it('viaja con el índice completo; con el índice a medias no hay regla', () => {
    expect(toRows(files, [])[0]!.rule).toBe('entry-convention');
    expect(toRows(files, [], { complete: false })[0]!.rule).toBeUndefined();
  });
});

describe('panel (DOM): «Por qué:»', () => {
  beforeAll(async () => {
    p = await mountPanel();
    await p.send(status());
    await p.send({ type: 'index', index: { rootName: 'r', complete: true, isGit: true, files, refs: [], commits: [] } });
  });

  it('dice qué regla decidió el estado y quita la pista que la repetiría', async () => {
    await select('index.html');
    expect(why()).toBe('Por qué: Punto de entrada por convención (index.html, vite.config…): lo carga algo de fuera del repo.');
    expect(hint()).toBeUndefined();
  });

  it('donde la pista aconseja algo, se quedan las dos', async () => {
    await select('a.png');
    expect(why()).toBe('Por qué: Ningún archivo lo referencia ni menciona su nombre.');
    expect(hint()).toContain('candidato a borrar');
    await select('b.png');
    expect(why()).toContain('heftmap.usage.weakSources');
  });

  it('sin regla (índice de antes), solo la pista de siempre', async () => {
    await select('old.png');
    expect(why()).toBeUndefined();
    expect(hint()).toContain('candidato a borrar');
  });
});
