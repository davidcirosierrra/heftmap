import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type HeftIndex } from '../src/core/index.js';
import { activate } from '../src/extension/extension.js';
import { CancelledError, type IndexEvents, type IndexRunner } from '../src/extension/runner.js';
import { fake, makeContext } from './fake-vscode.js';
import { createKartGame } from './fixture.js';

/**
 * Panel (fase 2) y aviso del primer análisis, con un runner manual: el test decide cuándo
 * llega cada cosa. La interfaz del webview no se ejecuta aquí; se prueba lo que la
 * extensión le manda y lo que hace con sus mensajes.
 */
interface Run {
  events: IndexEvents;
  resolve: (i: HeftIndex) => void;
}
const runs: Run[] = [];
const manualRunner: IndexRunner = (_root, _opts, events) => {
  const run = { events } as Run;
  let reject!: (e: Error) => void;
  const result = new Promise<HeftIndex>((res, rej) => {
    run.resolve = res;
    reject = rej;
  });
  result.catch(() => undefined);
  runs.push(run);
  return { result, cancel: () => reject(new CancelledError()) };
};

let root: string;
let full: HeftIndex;
let partial: HeftIndex;
let context: ReturnType<typeof makeContext>;

const tick = () => new Promise((r) => setTimeout(r, 10));
const panel = () => fake.panels.at(-1)!;
const last = (type: 'index' | 'status') => panel().posted.filter((m) => m.type === type).at(-1);
const message = () => fake.treeView!.message;

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

describe('primer análisis: aviso sobre el árbol y panel de espera', () => {
  it('sin datos todavía: la vista dice que está analizando', () => {
    expect(message()).toBe('Analizando el repositorio. En repos grandes puede tardar un poco.');
    runs[0]!.events.onProgress({ phase: 'read', done: 5, total: 27 });
    expect(message()).toBe('Analizando el repositorio (leyendo 5/27). En repos grandes puede tardar un poco.');
  });

  it('el panel se puede abrir ya: página con CSP y nonce, sin datos hasta que avisa', () => {
    void fake.commands.get('heft.openPanel')!();
    expect(fake.panels).toHaveLength(1);
    expect(panel().options.enableScripts).toBe(true);
    const nonce = /script-src 'nonce-([^']+)'/.exec(panel().html)?.[1];
    expect(nonce).toBeTruthy();
    expect(panel().html).toContain(`<script nonce="${nonce}"`);
    expect(panel().html).toContain("default-src 'none'");
    expect(panel().html).toContain('dist/webview.js');
    expect(panel().html).toContain('dist/webview.css');
    expect(panel().posted).toEqual([]);
  });

  it('al avisar «ready» recibe el estado: analizando, sin índice, con avance', () => {
    panel().receive.fire({ type: 'ready' });
    expect(last('index')).toEqual({ type: 'index', index: null });
    expect(last('status').status).toEqual({
      hasRoot: true,
      scope: [],
      building: true,
      progress: 'leyendo 5/27',
      fraction: 5 / 27,
      error: null,
    });
    runs[0]!.events.onProgress({ phase: 'read', done: 27, total: 27 });
    expect(last('status').status).toMatchObject({ progress: 'leyendo 27/27', fraction: 1 });
  });

  it('con los tamaños: el panel recibe los archivos y la vista cambia el aviso', () => {
    runs[0]!.events.onPartial(partial);
    const index = last('index').index;
    expect(index.complete).toBe(false);
    expect(index.files).toHaveLength(full.files.length);
    expect(index.files).toContainEqual({ path: 'public/models/kart.glb', size: full.files.find((f) => f.path === 'public/models/kart.glb')!.size });
    runs[0]!.events.onProgress({ phase: 'git', done: 0, total: 0 });
    expect(message()).toBe('Tamaños listos. Falta el uso y el historial de git (historial de git…).');
    expect(last('status').status).toMatchObject({ building: true, progress: 'historial de git…', fraction: null });
  });

  it('al terminar: índice completo y el aviso desaparece', async () => {
    runs[0]!.resolve(full);
    await tick();
    expect(message()).toBeUndefined();
    expect(last('index').index.complete).toBe(true);
    expect(last('status').status).toMatchObject({ building: false, progress: null, fraction: null });
  });

  it('un reanálisis con datos en pantalla no vuelve a poner el aviso', async () => {
    void fake.commands.get('heft.refresh')!();
    await tick();
    expect(message()).toBeUndefined();
    expect(last('status').status.building).toBe(true);
    runs[1]!.resolve(full);
    await tick();
  });
});

describe('panel: mensajes del webview', () => {
  it('abrir un archivo del índice', () => {
    panel().receive.fire({ type: 'open', path: 'src/main.tsx' });
    const call = fake.executed.at(-1)!;
    expect(call.id).toBe('vscode.open');
    expect(String(call.args[0])).toMatch(/\/src\/main\.tsx$/);
  });

  it('no abre rutas que no están en el índice', () => {
    const before = fake.executed.length;
    panel().receive.fire({ type: 'open', path: '../../etc/passwd' });
    panel().receive.fire({ type: 'open', path: 42 });
    expect(fake.executed).toHaveLength(before);
  });

  it('el ámbito llega al panel y se puede quitar desde sus chips, sin reenviar los archivos', () => {
    const indexMessages = panel().posted.filter((m) => m.type === 'index').length;
    void fake.commands.get('heft.limitScope')!({ kind: 'dir', path: 'src' });
    expect(last('status').status.scope).toEqual(['src']);
    panel().receive.fire({ type: 'removeScope', folder: 'src' });
    expect(last('status').status.scope).toEqual([]);
    expect(fake.state.get('heft.scope')).toEqual([]);
    expect(panel().posted.filter((m) => m.type === 'index')).toHaveLength(indexMessages);
  });

  it('«refresh» lanza un análisis', async () => {
    panel().receive.fire({ type: 'refresh' });
    await tick();
    expect(runs).toHaveLength(3);
    runs[2]!.resolve(full);
    await tick();
  });
});

describe('panel: ciclo de vida', () => {
  it('abrirlo otra vez no crea otro: lo trae al frente', () => {
    void fake.commands.get('heft.openPanel')!();
    expect(fake.panels).toHaveLength(1);
    expect(panel().revealed).toBe(1);
  });

  it('al volver a cargarse el webview (pestaña oculta y mostrada) recibe todo de nuevo', () => {
    const before = panel().posted.length;
    panel().receive.fire({ type: 'ready' });
    expect(panel().posted.slice(before).map((m) => m.type).sort()).toEqual(['index', 'status']);
  });

  it('cerrado y vuelto a abrir: panel nuevo, y al cerrado no se le manda nada', () => {
    const closed = panel();
    closed.close();
    const before = closed.posted.length;
    void fake.commands.get('heft.limitScope')!({ kind: 'dir', path: 'public' });
    expect(closed.posted).toHaveLength(before);
    void fake.commands.get('heft.openPanel')!();
    expect(fake.panels).toHaveLength(2);
    panel().receive.fire({ type: 'ready' });
    expect(last('status').status.scope).toEqual(['public']);
  });
});
