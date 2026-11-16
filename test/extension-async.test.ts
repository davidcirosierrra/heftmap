import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type HeftIndex } from '../src/core/index.js';
import { activate, progressLabel } from '../src/extension/extension.js';
import { i18n } from '../src/i18n/index.js';
import { CancelledError, type IndexEvents, type IndexRunner } from '../src/extension/runner.js';
import { fake, makeContext, type TreeItem } from './fake-vscode.js';
import { createKartGame } from './fixture.js';

/**
 * Análisis asíncrono visto desde la extensión, con un runner manual: el test decide cuándo
 * llega el progreso, el índice a medias y el resultado.
 */
interface Run {
  events: IndexEvents;
  resolve: (i: HeftIndex) => void;
  reject: (e: Error) => void;
  cancelled: boolean;
}
const runs: Run[] = [];
const manualRunner: IndexRunner = (_root, _opts, events) => {
  const run = { events, cancelled: false } as Run;
  const result = new Promise<HeftIndex>((resolve, reject) => {
    run.resolve = resolve;
    run.reject = reject;
  });
  runs.push(run);
  return {
    result,
    cancel: () => {
      run.cancelled = true;
      run.reject(new CancelledError());
    },
  };
};

let root: string;
let full: HeftIndex;
let partial: HeftIndex;
let context: ReturnType<typeof makeContext>;

const provider = () => fake.treeView!.provider;
const find = (label: string, node?: unknown): { node: any; item: TreeItem } => {
  for (const n of provider().getChildren(node)) {
    const item = provider().getTreeItem(n) as TreeItem;
    if (item.label === label) return { node: n, item };
  }
  throw new Error(`no hay «${label}» en el árbol`);
};
const physicsTip = (): string => (find('Physics.ts', find('game', find('src').node).node).item.tooltip as { value: string }).value;
const tick = () => new Promise((r) => setTimeout(r, 10));
const logged = (): number => fake.log.filter((l) => l.includes('Índice (')).length;

beforeAll(async () => {
  root = createKartGame();
  full = await buildIndex(root, {}, { onPartial: (i) => (partial = i) });
  fake.reset(root);
  context = makeContext();
  activate(context as never, manualRunner);
  await tick();
});
afterAll(() => {
  for (const d of context.subscriptions) d.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('extensión: análisis asíncrono', () => {
  it('etiquetas de progreso', () => {
    const es = i18n('es');
    expect(progressLabel(undefined, es)).toBe('analizando…');
    expect(progressLabel({ phase: 'git', done: 0, total: 0 }, es)).toBe('historial de git…');
    expect(progressLabel({ phase: 'usage', done: 12, total: 30 }, es)).toBe('uso 12/30');
    expect(progressLabel({ phase: 'usage', done: 1200, total: 3006 }, i18n('en'))).toBe('usage 1,200/3,006');
  });

  it('mientras analiza: barra de progreso sobre la vista y árbol vacío', () => {
    expect(runs).toHaveLength(1);
    expect(fake.progress).toEqual([{ location: { viewId: 'heft.folders' }, done: false }]);
    expect(fake.status.text).toBe('$(sync~spin) Heft: analizando…');
    expect(fake.treeView!.description).toBe('Todo el repositorio · analizando…');
    expect(provider().getChildren()).toEqual([]);
  });

  it('el avance se ve en la barra de estado', () => {
    runs[0]!.events.onProgress({ phase: 'read', done: 5, total: 27 });
    expect(fake.status.text).toBe('$(sync~spin) Heft: leyendo 5/27');
  });

  it('con el índice a medias ya hay árbol con tamaños, sin veredicto de uso', () => {
    runs[0]!.events.onPartial(partial);
    expect(find('public').item.description).toMatch(/^█+\S* \d+ % · \d+,\d MB · 10 arch\.$/);
    expect(physicsTip()).toContain('Analizando uso y git…');
    expect(physicsTip()).not.toContain('Referenciado');
    expect(physicsTip()).not.toContain('No analizado');
    runs[0]!.events.onProgress({ phase: 'usage', done: 12, total: 30 });
    expect(fake.status.text).toBe('$(sync~spin) Heft: uso 12/30');
  });

  it('al terminar: datos completos y la barra de progreso se cierra', async () => {
    runs[0]!.resolve(full);
    await tick();
    expect(physicsTip()).toContain('Referenciado');
    expect(physicsTip()).toContain('3 cambios');
    expect(fake.status.text).toMatch(/^\$\(layers\) Heft: Todo el repositorio · \d+ archivos/);
    expect(fake.treeView!.description).toMatch(/^Todo el repositorio · \d+ MB · 30 archivos$/);
    expect(fake.progress[0]!.done).toBe(true);
    expect(logged()).toBe(1);
  });

  it('un análisis nuevo cancela el que estaba en curso y descarta su resultado', async () => {
    void fake.commands.get('heft.refresh')!();
    void fake.commands.get('heft.refresh')!();
    await tick();
    expect(runs).toHaveLength(3);
    expect(runs[1]!.cancelled).toBe(true);
    expect(runs[2]!.cancelled).toBe(false);
    // Lo que diga el cancelado ya no cuenta.
    runs[1]!.events.onProgress({ phase: 'usage', done: 1, total: 2 });
    expect(fake.status.text).toBe('$(sync~spin) Heft: analizando…');
    runs[2]!.resolve(full);
    await tick();
    expect(logged()).toBe(2);
    expect(fake.status.text).toMatch(/^\$\(layers\)/);
  });

  it('durante un reanálisis se mantiene el índice completo: uno a medias no lo sustituye', async () => {
    void fake.commands.get('heft.refresh')!();
    await tick();
    runs[3]!.events.onPartial(partial);
    expect(physicsTip()).toContain('Referenciado');
    runs[3]!.resolve(full);
    await tick();
  });

  it('un error se muestra en la vista y no deja la extensión «analizando»', async () => {
    void fake.commands.get('heft.refresh')!();
    await tick();
    runs[4]!.reject(new Error('se rompió'));
    await tick();
    expect(fake.treeView!.message).toBe('No se pudo analizar el repositorio: se rompió');
    expect(fake.status.text).toMatch(/^\$\(layers\)/);
    expect(fake.log.at(-1)).toContain('se rompió');
  });
});
