import { buildIndex } from '../src/core/index.js';
import { CancelledError, type IndexRunner } from '../src/extension/runner.js';

/** El núcleo en el mismo hilo, para probar la extensión sin el bundle del worker. */
export const inProcessRunner: IndexRunner = (root, opts, events) => {
  let cancelled = false;
  const run = async () => {
    const index = await buildIndex(root, opts, {
      onProgress: (p) => !cancelled && events.onProgress(p),
      onPartial: (i) => !cancelled && events.onPartial(i),
    });
    if (cancelled) throw new CancelledError();
    return index;
  };
  return { result: run(), cancel: () => void (cancelled = true) };
};
