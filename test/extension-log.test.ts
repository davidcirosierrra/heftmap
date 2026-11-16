import { rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type HeftIndex } from '../src/core/index.js';
import { activate } from '../src/extension/extension.js';
import { CancelledError, workerRunner, type IndexEvents, type IndexRunner } from '../src/extension/runner.js';
import { fake, makeContext } from './fake-vscode.js';
import { createKartGame } from './fixture.js';

/** Registro de errores: que un fallo de Heft quede escrito, con su origen y su traza, y avise. */
interface Run {
  events: IndexEvents;
  resolve: (i: HeftIndex) => void;
  reject: (e: Error) => void;
}
const runs: Run[] = [];
const manualRunner: IndexRunner = (_root, _opts, events) => {
  const run = { events } as Run;
  const result = new Promise<HeftIndex>((res, rej) => {
    run.resolve = res;
    run.reject = rej;
  });
  result.catch(() => undefined);
  runs.push(run);
  return { result, cancel: () => run.reject(new CancelledError()) };
};

let root: string;
let full: HeftIndex;
let context: ReturnType<typeof makeContext>;
const tick = () => new Promise((r) => setTimeout(r, 10));
const errorsInLog = () => fake.log.filter((l) => l.startsWith('[error]'));

beforeAll(async () => {
  root = createKartGame();
  full = await buildIndex(root);
  fake.reset(root);
  context = makeContext();
  activate(context as never, manualRunner);
  await tick();
  runs[0]!.resolve(full);
  await tick();
});
afterAll(() => {
  for (const d of context.subscriptions) d.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('registro', () => {
  it('empieza con versión, editor, sistema, idioma y confianza', () => {
    expect(fake.log[0]).toMatch(/^Heft dev · heft=dev · vscode=1\.99\.0-test · app=Fake Code · platform=\w+ \w+ · node=[\d.]+ · locale=es · trusted=true · folders=1$/);
  });

  it('un comando que falla queda registrado con su origen y su traza, y avisa', async () => {
    const boom = {
      kind: 'dir',
      get path(): string {
        throw new Error('boom');
      },
    };
    await fake.commands.get('heft.revealInExplorer')!(boom);
    const entry = errorsInLog().at(-1)!;
    expect(entry).toMatch(/^\[error\] \[command heft\.revealInExplorer\] boom/);
    expect(entry).toMatch(/at /);
    expect(fake.errors).toEqual(['Heft: error interno en command heft.revealInExplorer: boom']);
  });

  it('los avisos no se repiten más de uno por minuto; el registro sí lo guarda todo', async () => {
    const before = errorsInLog().length;
    await fake.commands.get('heft.revealInExplorer')!({ kind: 'dir', get path(): string { throw new Error('otra'); } });
    expect(errorsInLog()).toHaveLength(before + 1);
    expect(fake.errors).toHaveLength(1);
  });

  it('un análisis que falla: error con la traza del worker y en la vista', async () => {
    void fake.commands.get('heft.refresh')!();
    await tick();
    const err = Object.assign(new Error('se rompió'), { stack: 'Error: se rompió\n    at buildIndex (worker.cjs:1:1)' });
    runs.at(-1)!.reject(err);
    await tick();
    const entry = errorsInLog().at(-1)!;
    expect(entry).toMatch(/^\[error\] \[analysis \(reason\.manual\)\] se rompió/);
    expect(entry).toContain('Error al construir el índice: se rompió');
    expect(entry).toContain('at buildIndex (worker.cjs:1:1)');
    expect(fake.treeView!.message).toBe('No se pudo analizar el repositorio: se rompió');
  });

  it('un fallo pintando el árbol se registra y la vista sigue viva', () => {
    const provider = fake.treeView!.provider;
    const item = provider.getTreeItem({ kind: 'file', file: null, parent: { size: 1 } });
    expect(item.label).toBeDefined();
    expect(errorsInLog().at(-1)).toMatch(/^\[error\] \[folders view\]/);
  });

  it('«Copiar informe de errores» lleva la cabecera y los errores', async () => {
    await fake.commands.get('heft.copyReport')!();
    expect(fake.clipboard).toMatch(/^Heft — error report\nheft=dev · vscode=1\.99\.0-test/);
    expect(fake.clipboard).toContain('[error] [command heft.revealInExplorer] boom');
    expect(fake.clipboard).toContain('se rompió');
    expect(fake.infos.at(-1)).toBe('Heft: informe de error copiado. Pégalo en una incidencia de GitHub.');
  });
});

describe('registro: worker que se cae', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'heft-crash-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('una excepción sin capturar en el worker llega con su traza', async () => {
    const file = path.join(dir, 'crash.cjs');
    writeFileSync(file, "function analizar() { throw new Error('caído en el worker'); }\nanalizar();\n");
    const job = workerRunner(file)(dir, {}, { onProgress: () => undefined, onPartial: () => undefined });
    const err = await job.result.catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('caído en el worker');
    expect((err as Error).stack).toContain('analizar');
  });
});
