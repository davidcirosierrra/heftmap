import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type HeftIndex, type Progress } from '../src/core/index.js';
import { CancelledError, workerRunner, type IndexRunner } from '../src/extension/runner.js';
import { createKartGame } from './fixture.js';

/**
 * El worker de verdad: se empaqueta `src/extension/worker.ts` igual que en `npm run build:worker`
 * y se lanza con `workerRunner`, como hace la extensión.
 */
let root: string;
let out: string;
let run: IndexRunner;

beforeAll(async () => {
  root = createKartGame();
  out = mkdtempSync(path.join(tmpdir(), 'heft-worker-'));
  const outfile = path.join(out, 'worker.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/extension/worker.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile,
    logLevel: 'silent',
  });
  run = workerRunner(outfile);
}, 60_000);
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

describe('análisis en un worker', () => {
  it('da el mismo índice que el núcleo en el mismo hilo, con progreso y un índice a medias antes', async () => {
    const progress: Progress[] = [];
    const partials: HeftIndex[] = [];
    const job = run(root, {}, { onProgress: (p) => progress.push(p), onPartial: (i) => partials.push(i) });
    const index = await job.result;
    const direct = await buildIndex(root);

    const summary = (i: HeftIndex) => i.files.map((f) => [f.path, f.size, f.lines, f.usage, f.changes, f.refsIn.length]);
    expect(summary(index)).toEqual(summary(direct));
    expect(index.complete).toBe(true);

    expect(partials).toHaveLength(1);
    expect(partials[0]!.complete).toBe(false);
    expect(partials[0]!.files.map((f) => [f.path, f.size])).toEqual(direct.files.map((f) => [f.path, f.size]));

    const phases = [...new Set(progress.map((p) => p.phase))];
    expect(phases).toEqual(['list', 'read', 'git', 'usage', 'mentions']);
    const lastUsage = progress.filter((p) => p.phase === 'usage').at(-1)!;
    expect(lastUsage.done).toBe(lastUsage.total);
  });

  it('cancelar termina el worker y rechaza con CancelledError', async () => {
    const job = run(root, {}, { onProgress: () => undefined, onPartial: () => undefined });
    job.cancel();
    await expect(job.result).rejects.toBeInstanceOf(CancelledError);
  });

  it('un fallo dentro del worker llega como error, no como cuelgue', async () => {
    const job = run(path.join(root, 'no-existe'), {}, { onProgress: () => undefined, onPartial: () => undefined });
    await expect(job.result).rejects.toThrow();
  });
});
