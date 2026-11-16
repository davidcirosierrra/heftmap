import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activate } from '../src/extension/extension.js';
import { i18n } from '../src/i18n/index.js';

const pct = i18n('es').pct;
import { fake, makeContext, Uri, type TreeItem } from './fake-vscode.js';
import { createRepo } from './fixture.js';
import { inProcessRunner } from './in-process-runner.js';

/** Fallos de la extensión encontrados en la revisión de código de la fase 1. */
let root: string;
let context: ReturnType<typeof makeContext>;

const provider = () => fake.treeView!.provider;
const find = (label: string, node?: unknown): { node: any; item: TreeItem } => {
  for (const n of provider().getChildren(node)) {
    const item = provider().getTreeItem(n) as TreeItem;
    if (item.label === label) return { node: n, item };
  }
  throw new Error(`no hay «${label}» en el árbol`);
};
const rebuilds = (): number => fake.log.filter((l) => l.includes('Índice (')).length;
const waitFor = async (cond: () => boolean, ms = 5000): Promise<void> => {
  for (let i = 0; i < ms / 25 && !cond(); i++) await new Promise((r) => setTimeout(r, 25));
  expect(cond()).toBe(true);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const u = (p: string) => Uri.file(path.join(root, p));
const write = (rel: string, content: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
};

beforeAll(async () => {
  root = createRepo({
    '.gitignore': 'dist\nnode_modules\n',
    'src/__tests__/a_b.test.ts': 'export {}\n',
    'src/old/x.ts': 'export {}\n',
    'src/main.ts': 'export {}\n',
  });
  fake.reset(root);
  fake.state.set('heftmap.scope', ['src/old', 'src/borrada']);
  context = makeContext();
  activate(context as never, inProcessRunner);
  await waitFor(() => rebuilds() === 1);
});
afterAll(() => {
  for (const d of context.subscriptions) d.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('extensión: arreglos de la revisión', () => {
  it('porcentajes como en el SPEC: sin decimal desde el 10 %', () => {
    expect(pct(0.51)).toBe('51 %');
    expect(pct(1)).toBe('100 %');
    expect(pct(0.034)).toBe('3,4 %');
    expect(pct(0.0004)).toBe('<0,1 %');
  });

  it('las rutas del tooltip van escapadas (__tests__ no se pinta en negrita)', () => {
    const tests = find('__tests__', find('src').node);
    expect((tests.item.tooltip as { value: string }).value).toContain('src/\\_\\_tests\\_\\_/');
    const f = find('a_b.test.ts', tests.node);
    expect((f.item.tooltip as { value: string }).value).toContain('a\\_b.test.ts');
  });

  it('al arrancar se quitan del ámbito las carpetas que ya no existen', () => {
    expect(fake.state.get('heftmap.scope')).toEqual(['src/old']);
  });

  it('no se añaden al ámbito carpetas sin archivos en el índice', async () => {
    mkdirSync(path.join(root, 'node_modules/x'), { recursive: true });
    await fake.commands.get('heftmap.addToScope')!(u('node_modules'));
    expect(fake.state.get('heftmap.scope')).toEqual(['src/old']);
    expect(fake.infos.at(-1)).toContain('«node_modules»');
  });

  it('cambiar las carpetas del workspace no acumula vigilantes', async () => {
    expect(fake.watchers).toBe(1);
    for (const fn of fake.folderListeners) fn();
    await waitFor(() => rebuilds() === 2);
    expect(fake.watchers).toBe(1);
  });

  it('los cambios en archivos ignorados por git no relanzan el análisis', async () => {
    const before = rebuilds();
    write('dist/bundle.js', 'x');
    fake.fs.create.fire(u('dist/bundle.js'));
    fake.fs.change.fire(u('dist/bundle.js'));
    fake.fs.delete.fire(u('dist/otro.js'));
    fake.fs.change.fire(u('.git/index'));
    await sleep(2000);
    expect(rebuilds()).toBe(before);
  });

  it('un archivo nuevo no ignorado sí lo relanza', async () => {
    const before = rebuilds();
    write('src/nuevo.ts', 'export {}\n');
    fake.fs.create.fire(u('src/nuevo.ts'));
    await waitFor(() => rebuilds() === before + 1);
    expect(find('nuevo.ts', find('src').node).item.label).toBe('nuevo.ts');
  });
});
