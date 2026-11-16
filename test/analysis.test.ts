import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeftIndex } from '../src/core/index.js';
import { i18n } from '../src/i18n/index.js';
import { Analysis, type AnalysisListener } from '../src/extension/analysis.js';
import { HeftLog } from '../src/extension/log.js';
import type { IndexRunner } from '../src/extension/runner.js';
import { fake, Uri } from './fake-vscode.js';

/** Ciclo de análisis con `heftmap.refreshDelay` y `heftmap.autoRefresh` (plan, pasos 2.1 y 2.2). */
const ROOT = '/repo';
let runs: string[];
let policy: { delay: number; auto: boolean };
let analysis: Analysis;

const runner: IndexRunner = (root) => {
  runs.push(root);
  return { result: new Promise<HeftIndex>(() => {}), cancel: () => {} };
};
const listener = (): AnalysisListener => ({
  options: () => ({}),
  inIndex: () => true,
  isGit: () => false,
  refresh: () => policy,
  onStart: () => {},
  onLaunched: () => {},
  onProgress: () => {},
  onPartial: () => {},
  onComplete: () => {},
  onError: () => {},
  onEnd: () => {},
});
const at = (rel: string) => Uri.file(path.join(ROOT, rel));

beforeEach(() => {
  vi.useFakeTimers();
  fake.reset(ROOT);
  runs = [];
  policy = { delay: 1500, auto: true };
  analysis = new Analysis(runner, new HeftLog(() => i18n('es')), listener());
  analysis.setRoot(Uri.file(ROOT) as any);
  analysis.watch();
});
afterEach(() => {
  analysis.dispose();
  vi.useRealTimers();
});

describe('Analysis: refresco', () => {
  it('un cambio en disco relanza el análisis tras el retardo configurado', async () => {
    policy.delay = 300;
    fake.fs.change.fire(at('src/a.ts'));
    await vi.advanceTimersByTimeAsync(299);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toEqual([ROOT]);
  });

  it('varios cambios seguidos dan un solo análisis', async () => {
    fake.fs.change.fire(at('src/a.ts'));
    await vi.advanceTimersByTimeAsync(1000);
    fake.fs.create.fire(at('src/b.ts'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(runs).toHaveLength(1);
  });

  it('con autoRefresh desactivado, ni el disco ni un commit relanzan; a mano sí', async () => {
    policy.auto = false;
    fake.fs.change.fire(at('src/a.ts'));
    fake.fs.create.fire(at('.git/refs/heads/main'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toHaveLength(0);
    void analysis.rebuild('reason.manual');
    expect(runs).toHaveLength(1);
  });

  it('con autoRefresh desactivado, un cambio planificado (ajustes, papelera) sigue analizando', async () => {
    policy.auto = false;
    analysis.schedule('reason.settings');
    await vi.advanceTimersByTimeAsync(1500);
    expect(runs).toHaveLength(1);
  });
});
