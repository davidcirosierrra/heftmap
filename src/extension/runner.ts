import { Worker } from 'node:worker_threads';
import type { BuildOptions, HeftIndex, Progress } from '../core/index.js';

/**
 * Quién ejecuta el análisis. La extensión no importa el núcleo directamente: lo lanza
 * a través de un `IndexRunner`, que en producción es un worker (no bloquea el proceso de
 * extensiones del editor) y en los tests puede ser el núcleo en el mismo hilo.
 */
export interface IndexEvents {
  onProgress(p: Progress): void;
  /** Índice a medias (archivos y tamaños), antes de git y del uso. */
  onPartial(index: HeftIndex): void;
}

export interface IndexJob {
  /** Se rechaza con `CancelledError` si se cancela antes de terminar. */
  result: Promise<HeftIndex>;
  cancel(): void;
}

export type IndexRunner = (root: string, opts: BuildOptions, events: IndexEvents) => IndexJob;

/** El worker terminó sin mandar resultado (se cayó). La extensión lo traduce al enseñarlo. */
export class WorkerExitError extends Error {
  constructor(readonly code: number) {
    super(`worker exited with code ${code}`);
    this.name = 'WorkerExitError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Análisis cancelado');
    this.name = 'CancelledError';
  }
}

/** Datos de arranque y mensajes entre la extensión y `worker.ts`. */
export interface WorkerInput {
  root: string;
  opts: BuildOptions;
}

export type WorkerMessage =
  | { type: 'progress'; progress: Progress }
  | { type: 'partial'; index: HeftIndex }
  | { type: 'done'; index: HeftIndex }
  | { type: 'error'; message: string; stack?: string };

/**
 * Un worker por análisis: cancelar es terminarlo, sin esperar a que el código síncrono
 * (el análisis de uso con TypeScript) llegue a un punto de control.
 */
export function workerRunner(workerFile: string): IndexRunner {
  return (root, opts, events) => {
    const input: WorkerInput = { root, opts };
    const worker = new Worker(workerFile, { workerData: input });
    let cancelled = false;
    const result = new Promise<HeftIndex>((resolve, reject) => {
      worker.on('message', (m: WorkerMessage) => {
        if (cancelled) return;
        if (m.type === 'progress') events.onProgress(m.progress);
        else if (m.type === 'partial') events.onPartial(m.index);
        else if (m.type === 'done') resolve(m.index);
        else reject(Object.assign(new Error(m.message), m.stack ? { stack: m.stack } : {}));
      });
      // Excepción sin capturar dentro del worker: llega con su traza.
      worker.on('error', reject);
      worker.on('messageerror', reject);
      // Si ya se resolvió o rechazó, esto no tiene efecto.
      worker.on('exit', (code) => {
        reject(cancelled ? new CancelledError() : new WorkerExitError(code));
      });
    });
    return {
      result,
      cancel: () => {
        cancelled = true;
        void worker.terminate();
      },
    };
  };
}
