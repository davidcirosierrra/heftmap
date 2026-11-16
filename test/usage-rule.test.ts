import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type HeftIndex, type Usage, type UsageRule } from '../src/core/index.js';
import { toPanelIndex } from '../src/extension/panel-data.js';
import { createKartGame } from './fixture.js';

/** La regla que decidió el veredicto de uso (paso 1.5 del plan): dato nuevo, sin efecto visible. */
let root: string;
let index: HeftIndex;

beforeAll(async () => {
  root = createKartGame();
  index = await buildIndex(root, {
    includeIgnored: true,
    ignore: ['public/models/trees.glb'],
    entryPoints: ['src/unused.ts'],
  });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const rule = (p: string): UsageRule | undefined => index.files.find((f) => f.path === p)?.usageRule;

/** Cada regla solo puede dar ciertos estados. */
const ALLOWED: Record<UsageRule, Usage[]> = {
  'ignored-by-git': ['ignored-by-git'],
  'ignore-setting': ['exception'],
  category: ['not-analyzed'],
  'hard-ref': ['referenced'],
  'entry-declared': ['entry'],
  'entry-convention': ['entry'],
  'weak-ref': ['mentioned'],
  'no-refs': ['none', 'no-importers'],
};

describe('regla del veredicto de uso', () => {
  it('todos los archivos del índice completo tienen regla, coherente con su estado', () => {
    for (const f of index.files) {
      expect(f.usageRule, f.path).toBeDefined();
      expect(ALLOWED[f.usageRule!], f.path).toContain(f.usage);
    }
  });

  it('una regla por caso', () => {
    expect(rule('node_modules')).toBe('ignored-by-git');
    expect(rule('public/models/trees.glb')).toBe('ignore-setting');
    expect(rule('README.md')).toBe('category');
    expect(rule('src/game/Physics.ts')).toBe('hard-ref');
    expect(rule('src/unused.ts')).toBe('entry-declared');
    expect(rule('index.html')).toBe('entry-convention');
    expect(rule('public/textures/grass.png')).toBe('weak-ref');
    expect(rule('public/audio/drift.mp3')).toBe('no-refs');
    expect(rule('src/nuevo.ts')).toBe('no-refs');
  });

  it('el índice a medias no tiene regla todavía', async () => {
    let partial: HeftIndex | undefined;
    await buildIndex(root, {}, { onPartial: (i) => (partial = i) });
    expect(partial?.complete).toBe(false);
    expect(partial!.files.every((f) => f.usageRule === undefined)).toBe(true);
  });

  it('la regla viaja al panel', () => {
    const panel = toPanelIndex(index, 'kart-game');
    expect(panel.files.find((f) => f.path === 'index.html')?.usageRule).toBe('entry-convention');
    expect(panel.files.find((f) => f.path === 'src/unused.ts')?.usageRule).toBe('entry-declared');
  });
});
