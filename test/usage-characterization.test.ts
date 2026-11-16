import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type HeftIndex, type Usage } from '../src/core/index.js';
import { createKartGame, createMonorepo } from './fixture.js';

/**
 * Test de caracterización del veredicto de uso (SPEC §3.3).
 *
 * Fija el estado de uso de TODOS los archivos de los fixtures tal y como sale hoy. No dice si es
 * correcto: es la red para partir `usage.ts` sin cambiar comportamiento. Si un cambio lo pone en
 * rojo a propósito, se actualiza la tabla en el mismo PR y se explica por qué.
 */
const usageMap = (index: HeftIndex): Record<string, Usage> =>
  Object.fromEntries(index.files.map((f) => [f.path, f.usage] as const).sort(([a], [b]) => (a < b ? -1 : 1)));

const KART: Record<string, Usage> = {
  '.gitignore': 'not-analyzed',
  'README.md': 'not-analyzed',
  'docs/shot.png': 'referenced',
  'index.html': 'entry',
  'package.json': 'not-analyzed',
  'public/audio/drift.mp3': 'none',
  'public/audio/engine.mp3': 'referenced',
  'public/audio/music.mp3': 'referenced',
  'public/gen/sprite.png': 'mentioned',
  'public/models/circuit.glb': 'referenced',
  'public/models/kart.glb': 'referenced',
  'public/models/trees.glb': 'none',
  'public/textures/asphalt.png': 'mentioned',
  'public/textures/grass.png': 'mentioned',
  'public/textures/sky.png': 'referenced',
  'scripts/gen.mjs': 'referenced',
  'src/components/App.tsx': 'referenced',
  'src/components/HUD.tsx': 'referenced',
  'src/components/Menu.tsx': 'referenced',
  'src/game/Camera.ts': 'referenced',
  'src/game/Kart.ts': 'referenced',
  'src/game/Physics.ts': 'referenced',
  'src/game/Track.ts': 'referenced',
  'src/main.tsx': 'referenced',
  'src/nuevo.ts': 'no-importers',
  'src/styles/fonts/pixel.woff2': 'referenced',
  'src/styles/index.css': 'referenced',
  'src/unused.ts': 'no-importers',
  'tsconfig.json': 'not-analyzed',
  'vite.config.ts': 'entry',
};

/** Con `includeIgnored` y una excepción: cubre `ignored-by-git` y `exception`. */
const KART_EXTRA: Record<string, Usage> = {
  '.gitignore': 'not-analyzed',
  'README.md': 'not-analyzed',
  'docs/shot.png': 'referenced',
  'index.html': 'entry',
  'node_modules': 'ignored-by-git',
  'package.json': 'not-analyzed',
  'public/audio/drift.mp3': 'none',
  'public/audio/engine.mp3': 'referenced',
  'public/audio/music.mp3': 'referenced',
  'public/gen/sprite.png': 'mentioned',
  'public/models/circuit.glb': 'referenced',
  'public/models/kart.glb': 'referenced',
  'public/models/trees.glb': 'exception',
  'public/textures/asphalt.png': 'mentioned',
  'public/textures/grass.png': 'mentioned',
  'public/textures/sky.png': 'referenced',
  'scripts/gen.mjs': 'referenced',
  'src/components/App.tsx': 'referenced',
  'src/components/HUD.tsx': 'referenced',
  'src/components/Menu.tsx': 'referenced',
  'src/game/Camera.ts': 'referenced',
  'src/game/Kart.ts': 'referenced',
  'src/game/Physics.ts': 'referenced',
  'src/game/Track.ts': 'referenced',
  'src/main.tsx': 'referenced',
  'src/nuevo.ts': 'no-importers',
  'src/styles/fonts/pixel.woff2': 'referenced',
  'src/styles/index.css': 'referenced',
  'src/unused.ts': 'no-importers',
  'tsconfig.json': 'not-analyzed',
  'vite.config.ts': 'entry',
};

const MONOREPO: Record<string, Usage> = {
  '.gitignore': 'not-analyzed',
  'apps/mobile/e2e/flow.ts': 'no-importers',
  'apps/mobile/package.json': 'not-analyzed',
  'apps/mobile/src/hooks/useTrip.ts': 'referenced',
  'apps/mobile/src/huerfano.ts': 'no-importers',
  'apps/mobile/src/lib/http.ts': 'referenced',
  'apps/mobile/src/main.tsx': 'no-importers',
  'apps/mobile/tsconfig.json': 'not-analyzed',
  'apps/web/app/page.ts': 'referenced',
  'apps/web/index.html': 'entry',
  'apps/web/package.json': 'not-analyzed',
  'apps/web/src/components/Card.ts': 'referenced',
  'apps/web/src/index.ts': 'referenced',
  'apps/web/tsconfig.app.json': 'not-analyzed',
  'apps/web/tsconfig.json': 'not-analyzed',
  'package.json': 'not-analyzed',
  'packages/api/package.json': 'not-analyzed',
  'packages/api/src/client.ts': 'referenced',
  'packages/api/src/index.ts': 'referenced',
  'packages/api/src/internal/deep.ts': 'referenced',
  'packages/cli/package.json': 'not-analyzed',
  'packages/cli/src/bin.ts': 'entry',
  'packages/cli/tools-local/gen.mjs': 'referenced',
  'packages/kit/package.json': 'not-analyzed',
  'packages/kit/src/format/index.ts': 'referenced',
  'packages/kit/src/i18n/index.ts': 'referenced',
  'packages/kit/src/locale/index.ts': 'referenced',
  'packages/theme/package.json': 'not-analyzed',
  'packages/theme/src/index.ts': 'referenced',
  'packages/types/package.json': 'not-analyzed',
  'packages/types/src/index.ts': 'referenced',
  'packages/ui/package.json': 'not-analyzed',
  'packages/ui/src/Button.tsx': 'referenced',
  'packages/ui/src/index.ts': 'entry',
  'tsconfig.base.json': 'not-analyzed',
};

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('caracterización del veredicto de uso: kart-game', () => {
  let root: string;
  beforeAll(() => {
    root = createKartGame();
    roots.push(root);
  });

  it('opciones por defecto', async () => {
    expect(usageMap(await buildIndex(root))).toEqual(KART);
  });

  it('con includeIgnored y una excepción', async () => {
    expect(usageMap(await buildIndex(root, { includeIgnored: true, ignore: ['public/models/trees.glb'] }))).toEqual(KART_EXTRA);
  });
});

describe('caracterización del veredicto de uso: monorepo', () => {
  it('opciones por defecto', async () => {
    const root = createMonorepo();
    roots.push(root);
    expect(usageMap(await buildIndex(root))).toEqual(MONOREPO);
  });
});
