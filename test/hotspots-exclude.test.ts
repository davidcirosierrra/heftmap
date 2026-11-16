import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type HeftIndex } from '../src/core/index.js';
import { activate } from '../src/extension/extension.js';
import { toPanelIndex } from '../src/extension/panel-data.js';
import type { IndexRunner } from '../src/extension/runner.js';
import { fake, makeContext } from './fake-vscode.js';
import { createKartGame } from './fixture.js';
import { inProcessRunner } from './in-process-runner.js';

/** Ajuste `heftmap.hotspots.exclude` (plan, paso 2.6). */
let root: string;
let index: HeftIndex;
let context: ReturnType<typeof makeContext>;
let analyses = 0;
const counting: IndexRunner = (r, o, e) => {
  analyses++;
  return inProcessRunner(r, o, e);
};
const waitFor = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25));
  expect(cond()).toBe(true);
};
const panel = () => fake.panels.at(-1)!;
const lastIndex = () => panel().posted.filter((m: any) => m.type === 'index').at(-1)?.index;
const isCode = (p: string): boolean | undefined => lastIndex()?.files.find((f: any) => f.path === p)?.code;

beforeAll(async () => {
  root = createKartGame();
  index = await buildIndex(root);
  fake.reset(root);
  context = makeContext();
  activate(context as never, counting);
  void fake.commands.get('heftmap.openPanel')!();
  panel().receive.fire({ type: 'ready' });
  await waitFor(() => lastIndex()?.complete === true);
});
afterAll(() => {
  for (const d of context.subscriptions) d.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('heftmap.hotspots.exclude', () => {
  it('toPanelIndex: lo que casa deja de ser código para los hotspots, pero sigue en la tabla', () => {
    const p = toPanelIndex(index, 'kart', undefined, (path) => path.startsWith('src/game/'));
    const at = (path: string) => p.files.find((f) => f.path === path);
    expect(at('src/game/Physics.ts')).toBeDefined();
    expect(at('src/game/Physics.ts')?.code).toBeUndefined();
    expect(at('src/main.tsx')?.code).toBe(true);
  });

  it('cambiar el ajuste repinta el panel sin volver a analizar', async () => {
    expect(isCode('src/game/Physics.ts')).toBe(true);
    const before = analyses;
    fake.config['hotspots.exclude'] = ['src/game'];
    fake.configListeners.forEach((fn) => fn({ affectsConfiguration: (k: string) => k === 'heftmap' || k === 'heftmap.hotspots.exclude' }));
    expect(isCode('src/game/Physics.ts')).toBeUndefined();
    expect(isCode('src/main.tsx')).toBe(true);
    await new Promise((r) => setTimeout(r, 1700));
    expect(analyses).toBe(before);
  });

  it('un patrón peligroso se avisa en el registro', () => {
    fake.config['hotspots.exclude'] = ['a/**/b/**/c/**/d/**/x'];
    fake.configListeners.forEach((fn) => fn({ affectsConfiguration: (k: string) => k === 'heftmap' || k === 'heftmap.hotspots.exclude' }));
    expect(fake.log.some((l) => l.includes('heftmap.hotspots.exclude') && l.includes('a/**/b'))).toBe(true);
  });
});
