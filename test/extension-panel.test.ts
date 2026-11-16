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
const opts: { useGit?: boolean }[] = [];
const lastOpts = () => opts.at(-1)!;
const manualRunner: IndexRunner = (_root, runOpts, events) => {
  opts.push(runOpts);
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
      locale: 'es',
    });
    runs[0]!.events.onProgress({ phase: 'read', done: 27, total: 27 });
    expect(last('status').status).toMatchObject({ progress: 'leyendo 27/27', fraction: 1 });
  });

  it('con los tamaños: el panel recibe los archivos y la vista cambia el aviso', () => {
    runs[0]!.events.onPartial(partial);
    const index = last('index').index;
    expect(index.complete).toBe(false);
    expect(index.files).toHaveLength(full.files.length);
    expect(index.files.find((f: any) => f.path === 'public/models/kart.glb')).toMatchObject({ size: full.files.find((f) => f.path === 'public/models/kart.glb')!.size });
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

  it('con el índice completo viajan el estado de uso y el grafo de referencias', () => {
    const { files, refs } = last('index').index;
    const at = (p: string): number => files.findIndex((f: any) => f.path === p);
    expect(files[at('public/models/trees.glb')].usage).toBe('none');
    expect(files[at('public/textures/grass.png')].usage).toBe('mentioned');
    expect(files[at('index.html')].usage).toBe('entry');
    expect(refs).toContainEqual([at('src/main.tsx'), at('src/components/App.tsx'), 'import']);
    // Una arista por referencia, no dos (entrada y salida).
    expect(refs).toHaveLength(full.files.reduce((s, f) => s + f.refsOut.length, 0));
  });

  it('y los datos de git: cada commit una sola vez, y qué archivos tienen cambios', () => {
    const { files, commits, isGit } = last('index').index;
    expect(isGit).toBe(true);
    expect(commits).toHaveLength(new Set(full.files.map((f) => f.lastCommit?.hash).filter(Boolean)).size);
    const physics = files.find((f: any) => f.path === 'src/game/Physics.ts');
    expect(commits[physics.commit]).toEqual(full.files.find((f) => f.path === 'src/game/Physics.ts')!.lastCommit);
    // Lo que el núcleo da por nuevo o modificado llega igual al panel.
    for (const f of full.files) {
      const sent = files.find((x: any) => x.path === f.path);
      expect(!!sent.dirty).toBe(f.dirty);
      expect(!!sent.untracked).toBe(f.untracked);
      if (!f.lastCommit) expect(sent.commit).toBeUndefined();
    }
    expect(full.files.some((f) => f.untracked)).toBe(true);
  });

  it('y líneas, cambios y generados para los hotspots', () => {
    const { files } = last('index').index;
    for (const f of full.files) {
      const sent = files.find((x: any) => x.path === f.path);
      expect(sent.lines ?? null).toBe(f.lines);
      expect(sent.changes ?? 0).toBe(f.changes);
      expect(!!sent.generated).toBe(f.generated);
    }
    expect(files.find((f: any) => f.path === 'src/game/Physics.ts')).toMatchObject({ changes: 3 });
    expect(files.find((f: any) => f.path === 'public/models/kart.glb').lines).toBeUndefined();
  });

  it('y la hora en que llegó el índice, para la línea de estado del panel', () => {
    const at = last('index').index.updatedAt;
    expect(Math.abs(Date.now() - at)).toBeLessThan(5000);
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

  it('revelar en el explorador', () => {
    panel().receive.fire({ type: 'reveal', path: 'src/main.tsx' });
    expect(fake.executed.at(-1)!.id).toBe('revealInExplorer');
    const before = fake.executed.length;
    panel().receive.fire({ type: 'reveal', path: '/etc/passwd' });
    expect(fake.executed).toHaveLength(before);
  });

  it('«Ver diff» usa el comando de git del editor', () => {
    panel().receive.fire({ type: 'diff', path: 'src/main.tsx' });
    expect(fake.executed.at(-1)!.id).toBe('git.openChange');
    const before = fake.executed.length;
    panel().receive.fire({ type: 'diff', path: 'no/existe.ts' });
    expect(fake.executed).toHaveLength(before);
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

describe('panel: acciones sobre «sin rastro»', () => {
  it('«Ignorar este archivo» lo añade a heft.usage.ignore del workspace', async () => {
    panel().receive.fire({ type: 'ignoreUsage', path: 'public/models/trees.glb' });
    await tick();
    expect(fake.configUpdates).toEqual([{ key: 'usage.ignore', value: ['public/models/trees.glb'], target: 2 }]);
    panel().receive.fire({ type: 'ignoreUsage', path: 'public/models/trees.glb' });
    panel().receive.fire({ type: 'ignoreUsage', path: 'no/existe.glb' });
    await tick();
    expect(fake.configUpdates).toHaveLength(1);
  });

  it('«Mover a la papelera…» pregunta antes; sin confirmar no borra', async () => {
    panel().receive.fire({ type: 'trash', path: 'public/audio/drift.mp3' });
    await tick();
    expect(fake.warnings).toHaveLength(1);
    expect(fake.warnings[0]!.message).toBe('¿Mover «public/audio/drift.mp3» a la papelera?');
    expect(fake.warnings[0]!.options.modal).toBe(true);
    expect(fake.deleted).toEqual([]);
  });

  it('confirmado: a la papelera, nunca borrado definitivo', async () => {
    fake.warningAnswer = 'Mover a la papelera';
    panel().receive.fire({ type: 'trash', path: 'public/audio/drift.mp3' });
    await tick();
    expect(fake.deleted).toHaveLength(1);
    expect(fake.deleted[0]!.path).toMatch(/public\/audio\/drift\.mp3$/);
    expect(fake.deleted[0]!.options).toEqual({ useTrash: true });
  });

  it('no mueve a la papelera nada que no sea «sin rastro», aunque el panel lo pida', async () => {
    const before = fake.warnings.length;
    for (const path of ['src/main.tsx', 'public/models/kart.glb', 'public/textures/grass.png', '../fuera.txt', 42]) {
      panel().receive.fire({ type: 'trash', path });
    }
    await tick();
    expect(fake.warnings).toHaveLength(before);
    expect(fake.deleted).toHaveLength(1);
  });
});

describe('panel: errores del webview', () => {
  it('van al registro de Heft, con la traza', () => {
    panel().receive.fire({ type: 'error', where: 'al pintar', message: 'destroy is not a function', stack: 'TypeError: x\n   at App' });
    const entry = fake.log.at(-1)!;
    expect(entry).toMatch(/^\[error\] \[panel \(al pintar\)\] destroy is not a function/);
    expect(entry).toContain('at App');
    // El panel ya enseña su pantalla de error: no hace falta otro aviso.
    expect(fake.errors).toEqual([]);
  });

  it('copiar el error y abrir el registro', () => {
    panel().receive.fire({ type: 'copy', text: 'traza' });
    expect(fake.clipboard).toBe('traza');
    const shown = fake.logShown;
    panel().receive.fire({ type: 'showLog' });
    expect(fake.logShown).toBe(shown + 1);
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

describe('idioma de la extensión', () => {
  it('sigue al editor y el ajuste heft.language manda; cambiarlo repinta sin reanalizar', async () => {
    const { env } = await import('./fake-vscode.js');
    const before = runs.length;
    // Editor en inglés, ajuste en «auto».
    env.language = 'en';
    fake.config['language'] = 'auto';
    fake.configListeners.forEach((fn) => fn({ affectsConfiguration: (k: string) => k === 'heft' || k === 'heft.language' }));
    expect(fake.status.text).toMatch(/^\$\(layers\) Heft: (Whole repository|public) · \d+ files · /);
    expect(last('status').status.locale).toBe('en');
    // El ajuste fuerza euskera aunque el editor esté en inglés.
    fake.config['language'] = 'eu';
    fake.configListeners.forEach((fn) => fn({ affectsConfiguration: (k: string) => k === 'heft' || k === 'heft.language' }));
    expect(fake.status.text).toMatch(/^\$\(layers\) Heft: (Biltegi osoa|public) · \d+ fitxategi · /);
    expect(last('status').status.locale).toBe('eu');
    await tick();
    expect(runs).toHaveLength(before);
    env.language = 'es';
    fake.config['language'] = 'auto';
    fake.configListeners.forEach((fn) => fn({ affectsConfiguration: (k: string) => k === 'heft' || k === 'heft.language' }));
  });
});

describe('workspace sin confianza', () => {
  it('se analiza sin git, la vista lo dice y al confiar se vuelve a analizar con git', async () => {
    const { workspace } = await import('./fake-vscode.js');
    const seen: (boolean | undefined)[] = [];
    const before = runs.length;
    (workspace as { isTrusted: boolean }).isTrusted = false;
    void fake.commands.get('heft.refresh')!();
    await tick();
    expect(runs).toHaveLength(before + 1);
    seen.push(lastOpts().useGit);
    runs.at(-1)!.resolve(full);
    await tick();
    expect(fake.treeView!.message).toBe('Modo restringido: se analiza sin git (sin historial ni cambios sin commit). Confía en la carpeta para verlos.');
    (workspace as { isTrusted: boolean }).isTrusted = true;
    fake.trustListeners.forEach((fn) => fn());
    await tick();
    seen.push(lastOpts().useGit);
    runs.at(-1)!.resolve(full);
    await tick();
    expect(seen).toEqual([false, true]);
    expect(fake.treeView!.message).toBeUndefined();
  });
});
