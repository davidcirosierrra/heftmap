import { parentPort, workerData } from 'node:worker_threads';
import { buildIndex } from '../core/index.js';
import type { WorkerInput, WorkerMessage } from './runner.js';

/**
 * Análisis en un worker: aquí vive el núcleo (y TypeScript, que es casi todo el peso).
 * Bundle aparte (`dist/worker.cjs`); la extensión solo lo lanza y escucha.
 *
 * Va en una función y no con `await` de primer nivel porque el bundle es CommonJS
 * (TypeScript empaquetado no funciona en ESM, ver docs/fase-0.md).
 */
async function main(): Promise<void> {
  const port = parentPort;
  if (!port) throw new Error('worker.ts solo se ejecuta como worker');
  const post = (m: WorkerMessage): void => port.postMessage(m);
  const { root, opts } = workerData as WorkerInput;
  try {
    const index = await buildIndex(root, opts, {
      onProgress: (progress) => post({ type: 'progress', progress }),
      onPartial: (partial) => post({ type: 'partial', index: partial }),
    });
    post({ type: 'done', index });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

void main();
