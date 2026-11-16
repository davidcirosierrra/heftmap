import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/core/index.js';
import { activate } from '../src/extension/extension.js';
import { i18n } from '../src/i18n/index.js';
import { renderTable } from '../src/report.js';
import { fake, makeContext } from './fake-vscode.js';
import { createKartGame } from './fixture.js';
import { inProcessRunner } from './in-process-runner.js';

/** «Copiar tabla» (plan, paso 3.5). */
const es = i18n('es');
const entry = (o: Partial<FileEntry>): FileEntry =>
  ({ path: 'a.ts', size: 1536, lines: 10, changes: 2, usage: 'referenced', untracked: false, dirty: false, lastCommit: null, ...o }) as FileEntry;

describe('renderTable', () => {
  const commit = { hash: 'x'.repeat(40), short: 'abc1234', author: 'D', subject: 's', time: Date.UTC(2026, 10, 3) };

  it('Markdown: cabecera, alineación, tamaños legibles y barras escapadas', () => {
    const md = renderTable([entry({ path: 'src/a|b.ts', lastCommit: commit })], 'markdown', es);
    const lines = md.trimEnd().split('\n');
    expect(lines[0]).toBe('| Ruta | Tamaño | Líneas | Cambios | Uso | Último cambio |');
    expect(lines[1]).toBe('| --- | ---: | ---: | ---: | --- | --- |');
    expect(lines[2]?.startsWith(`| src/a\\|b.ts | ${es.size(1536)} | 10 | 2 | Referenciado | abc1234 `)).toBe(true);
  });

  it('CSV: bytes, fecha ISO, comillas y nada que se ejecute como fórmula', () => {
    const csv = renderTable(
      [entry({ path: 'x,y.ts', lastCommit: commit }), entry({ path: '=cmd.ts', untracked: true, lines: null })],
      'csv',
      es,
    );
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Ruta,Tamaño,Líneas,Cambios,Uso,Último cambio');
    expect(lines[1]).toBe('"x,y.ts",1536,10,2,Referenciado,abc1234 2026-11-03');
    expect(lines[2]).toBe("'=cmd.ts,1536,,2,Referenciado,nuevo");
  });
});

describe('extensión: copiar tabla', () => {
  let root: string;
  let context: ReturnType<typeof makeContext>;
  const panel = () => fake.panels.at(-1)!;
  const waitFor = async (cond: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25));
    expect(cond()).toBe(true);
  };

  beforeAll(async () => {
    root = createKartGame();
    fake.reset(root);
    context = makeContext();
    activate(context as never, inProcessRunner);
    await waitFor(() => fake.log.some((l) => l.includes('Índice (')));
  });
  afterAll(() => {
    for (const d of context.subscriptions) d.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it('sin panel, el comando copia todo el ámbito en el formato elegido', async () => {
    fake.quickPickAnswer = (items) => items[0];
    await fake.commands.get('heftmap.exportTable')!();
    expect(fake.clipboard.split('\n')[0]).toBe('| Ruta | Tamaño | Líneas | Cambios | Uso | Último cambio |');
    expect(fake.clipboard).toContain('| src/game/Physics.ts |');
    expect(fake.infos.at(-1)).toMatch(/^Heftmap: tabla copiada \(\d+ archivos, Markdown\)\.$/);
  });

  it('con panel, copia las filas que manda el panel, en su orden, y solo rutas del índice', async () => {
    void fake.commands.get('heftmap.openPanel')!();
    panel().receive.fire({ type: 'ready' });
    await fake.commands.get('heftmap.exportTable')!();
    expect(panel().posted.at(-1)).toEqual({ type: 'requestExport' });
    fake.quickPickAnswer = (items) => items[1];
    panel().receive.fire({ type: 'exportTable', paths: ['src/main.tsx', '../../etc/passwd', 'README.md', 7] });
    await waitFor(() => fake.clipboard.startsWith('Ruta,'));
    const lines = fake.clipboard.trimEnd().split('\r\n');
    expect(lines.map((l) => l.split(',')[0])).toEqual(['Ruta', 'src/main.tsx', 'README.md']);
  });

  it('si no se elige formato, no se copia nada', async () => {
    fake.clipboard = '';
    fake.quickPickAnswer = () => undefined;
    panel().receive.fire({ type: 'exportTable', paths: ['README.md'] });
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.clipboard).toBe('');
  });
});
