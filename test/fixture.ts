import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Proyecto ficticio `kart-game` del SPEC §7, con git y tres commits. */
export function createKartGame(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'heft-kart-'));
  const write = (rel: string, content: string | Buffer): void => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  const bin = (kb: number): Buffer => Buffer.alloc(kb * 1024, 7);
  const git = (...args: string[]): void => {
    execFileSync('git', args, {
      cwd: root,
      stdio: 'ignore',
      env: { ...process.env, GIT_AUTHOR_NAME: 'David', GIT_AUTHOR_EMAIL: 'd@example.com', GIT_COMMITTER_NAME: 'David', GIT_COMMITTER_EMAIL: 'd@example.com' },
    });
  };

  write('package.json', JSON.stringify({ name: 'kart-game', scripts: { dev: 'vite', gen: 'node scripts/gen.mjs' } }, null, 2));
  write('tsconfig.json', JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', jsx: 'react-jsx', paths: { '@game/*': ['./src/game/*'] } }, include: ['src'] }));
  write('vite.config.ts', `import { defineConfig } from 'vite'\nexport default defineConfig({})\n`);
  write('index.html', `<!doctype html>\n<html><body>\n<script type="module" src="/src/main.tsx"></script>\n</body></html>\n`);
  write('README.md', `# Kart\n\n![captura](docs/shot.png)\n\nLa lógica muerta está en \`src/unused.ts\`.\n`);
  write('docs/shot.png', bin(40));
  // Un generador nombra lo que escribe: eso no es uso.
  write('scripts/gen.mjs', `import { writeFileSync } from 'node:fs'\nwriteFileSync('public/gen/sprite.png', '')\n`);
  write('public/gen/sprite.png', bin(5));

  write('src/main.tsx', `import App from './components/App'\nimport './styles/index.css'\nApp()\n`);
  write(
    'src/components/App.tsx',
    `import { HUD } from './HUD'\nimport { Menu } from './Menu'\nimport { Track } from '../game/Track'\nimport { Camera } from '../game/Camera'\nimport { Kart } from '../game/Kart'\nconst music = '/audio/music.mp3'\nexport default function App() { return [HUD, Menu, Track, Camera, Kart, music] }\n`,
  );
  write('src/components/HUD.tsx', `import type { Kart } from '../game/Kart'\nexport const HUD = (k?: Kart) => k\n`);
  write('src/components/Menu.tsx', `import { Physics } from '@game/Physics'\nexport const Menu = Physics\n`);
  write(
    'src/game/Track.ts',
    `import { Physics } from './Physics'\nconst SURFACES = ['asphalt', 'grass']\nexport const Track = {\n  model: '/models/circuit.glb',\n  sky: '/textures/sky.png',\n  textures: SURFACES.map((s) => \`/textures/\${s}.png\`),\n  Physics,\n}\n`,
  );
  write('src/game/Kart.ts', `import { Physics } from './Physics'\nexport class Kart { model = '/models/kart.glb'; engine = '/audio/engine.mp3'; p = Physics }\n`);
  write('src/game/Camera.ts', `import type { Kart } from './Kart'\nexport const Camera = (k?: Kart) => k\n`);
  write('src/game/Physics.ts', `/** Antes vivía en '../unused.ts'. */\nexport const Physics = { friction: 1 }\n`);
  write('src/styles/index.css', `@font-face { font-family: pixel; src: url('./fonts/pixel.woff2'); }\nbody { margin: 0 }\n`);
  write('src/styles/fonts/pixel.woff2', bin(12));
  write('src/unused.ts', `export const nadie = 1\n`);

  write('public/models/circuit.glb', bin(840));
  write('public/models/kart.glb', bin(410));
  write('public/models/trees.glb', bin(280));
  write('public/audio/music.mp3', bin(530));
  write('public/audio/engine.mp3', bin(150));
  write('public/audio/drift.mp3', bin(60));
  write('public/textures/sky.png', bin(310));
  write('public/textures/asphalt.png', bin(210));
  write('public/textures/grass.png', bin(180));
  write('.gitignore', 'node_modules\ndist\n');
  write('node_modules/vite/index.js', 'x'.repeat(5000));

  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Proyecto inicial');
  write('src/game/Physics.ts', `export const Physics = { friction: 0.8 }\n`);
  write('src/game/Kart.ts', `import { Physics } from './Physics'\nexport class Kart { model = '/models/kart.glb'; engine = '/audio/engine.mp3'; p = Physics; speed = 2 }\n`);
  git('commit', '-q', '-am', 'Ajusta la fricción');
  write('src/game/Physics.ts', `export const Physics = { friction: 0.7, grip: 1 }\n`);
  git('commit', '-q', '-am', 'Añade agarre');

  // Estado de trabajo: un cambio sin commit y un archivo nuevo
  write('src/game/Physics.ts', `export const Physics = { friction: 0.7, grip: 1.1 }\n`);
  write('src/nuevo.ts', `export const nuevo = 1\n`);
  return root;
}

/** Repo mínimo con git y un commit, a partir de un mapa ruta → contenido. */
export function createRepo(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'heft-repo-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const git = (...args: string[]): void => {
    execFileSync('git', args, {
      cwd: root,
      stdio: 'ignore',
      env: { ...process.env, GIT_AUTHOR_NAME: 'David', GIT_AUTHOR_EMAIL: 'd@example.com', GIT_COMMITTER_NAME: 'David', GIT_COMMITTER_EMAIL: 'd@example.com' },
    });
  };
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Inicial');
  return root;
}

/**
 * Monorepo del SPEC §4.3: cada app con su tsconfig y sus alias, paquetes del repo importados por
 * nombre, con y sin `node_modules`, y un commit.
 */
export function createMonorepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'heft-mono-'));
  const write = (rel: string, content: string | object): void => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };
  write('.gitignore', 'node_modules\ndist\n');
  // Sin tsconfig.json en la raíz: solo una base que las apps extienden.
  write('package.json', { name: 'acme', private: true, workspaces: ['apps/*', 'packages/*'], devDependencies: { typescript: '^5.0.0' } });
  write('tsconfig.base.json', { compilerOptions: { strict: true, module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve' } });

  // --- app móvil: alias @/* → src/*
  write('apps/mobile/package.json', { name: '@acme/mobile', dependencies: { react: '^19.0.0', '@acme/api': 'workspace:*', '@acme/ui': 'workspace:*', '@acme/types': 'workspace:*' } });
  write('apps/mobile/tsconfig.json', { extends: '../../tsconfig.base.json', compilerOptions: { paths: { '@/*': ['./src/*'], '#kit/*': ['../../packages/kit/src/*.ts'] } }, include: ['src'] });
  write(
    'apps/mobile/src/main.tsx',
    [
      "import React from 'react'",
      "import fs from 'node:fs'",
      "import { useTrip } from '@/hooks/useTrip'",
      "import { client } from '@acme/api'",
      "import { Button } from '@acme/ui/Button'",
      "import type { Trip } from '@acme/types'",
      "import { theme } from '@acme/theme'",
      "import { deep } from '@acme/api/internal/deep'",
      "import { t } from '@acme/kit/i18n'",
      "import { locale } from '@acme/kit/locale'",
      "import { format } from '#kit/format'",
      'export const app = [React, fs, useTrip, client, Button, theme, deep, t, locale, format] as unknown as Trip',
    ].join('\n'),
  );
  write('apps/mobile/src/hooks/useTrip.ts', "import { http } from '@/lib/http'\nimport { x } from '~/aliasDelBundler/x'\nexport const useTrip = () => [http, x]\n");
  write('apps/mobile/src/lib/http.ts', 'export const http = 1\n');
  write('apps/mobile/src/huerfano.ts', 'export const nadie = 1\n');
  // Fuera del `include` del tsconfig: usa el más cercano igualmente.
  write('apps/mobile/e2e/flow.ts', "import { http } from '@/lib/http'\nexport const flow = http\n");

  // --- app web: mismo alias, otro destino; y baseUrl
  write('apps/web/package.json', { name: '@acme/web', dependencies: { '@acme/api': 'workspace:*' } });
  write('apps/web/tsconfig.json', { files: [], references: [{ path: './tsconfig.app.json' }] });
  write('apps/web/tsconfig.app.json', { extends: '../../tsconfig.base.json', compilerOptions: { baseUrl: 'src', paths: { '@/*': ['../app/*'] } }, include: ['src', 'app'] });
  write('apps/web/src/index.ts', "import { page } from '@/page'\nimport { Card } from 'components/Card'\nimport { client } from '@acme/api'\nexport default [page, Card, client]\n");
  write('apps/web/app/page.ts', 'export const page = 1\n');
  write('apps/web/index.html', '<!doctype html><script type="module" src="/src/index.ts"></script>');
  write('apps/web/src/components/Card.ts', 'export const Card = 1\n');

  // --- paquetes
  write('packages/api/package.json', { name: '@acme/api', main: 'dist/index.js', types: 'dist/index.d.ts' });
  write('packages/api/src/index.ts', "export { client } from './client'\n");
  write('packages/api/src/client.ts', 'export const client = 1\n');
  write('packages/api/src/internal/deep.ts', 'export const deep = 1\n');
  write('packages/ui/package.json', { name: '@acme/ui', exports: { '.': './src/index.ts', './*': { types: './dist/*.d.ts', import: './dist/*.js' } } });
  write('packages/ui/src/index.ts', "export * from './Button'\n");
  write('packages/ui/src/Button.tsx', 'export const Button = 1\n');
  write('packages/types/package.json', { name: '@acme/types' });
  write('packages/types/src/index.ts', 'export type Trip = { id: string }\n');
  write('packages/theme/package.json', { name: '@acme/theme', main: 'src/index.ts' });
  write('packages/theme/src/index.ts', 'export const theme = 1\n');
  write('packages/cli/package.json', { name: '@acme/cli', bin: { acme: './dist/bin.js' }, scripts: { gen: 'node ./tools-local/gen.mjs' } });
  write('packages/cli/src/bin.ts', 'export {}\n');
  write('packages/cli/tools-local/gen.mjs', 'export {}\n');

  // `@acme/kit` compilado (dist/ existe pero git lo ignora) y enlazado en node_modules:
  // TypeScript resuelve `@acme/kit/i18n` a `packages/kit/dist/i18n/index.d.ts`.
  write('packages/kit/package.json', {
    name: '@acme/kit',
    exports: { './i18n': { types: './dist/i18n/index.d.ts', import: './dist/i18n/index.js' }, './*': './src/*.ts' },
  });
  write('packages/kit/src/i18n/index.ts', 'export const t = (k: string) => k\n');
  // Patrón `./*` → `./src/*.ts` y un import que es una carpeta: `src/locale/index.ts`.
  write('packages/kit/src/locale/index.ts', 'export const locale = 1\n');
  write('packages/kit/src/format/index.ts', 'export const format = 1\n');
  write('packages/kit/dist/i18n/index.d.ts', 'export declare const t: (k: string) => string\n');
  write('packages/kit/dist/i18n/index.js', 'export const t = (k) => k\n');
  mkdirSync(path.join(root, 'node_modules/@acme'), { recursive: true });
  symlinkSync(path.join(root, 'packages/kit'), path.join(root, 'node_modules/@acme/kit'), 'dir');

  // `@acme/theme` instalado como enlace de workspace: TypeScript lo resuelve por node_modules.
  mkdirSync(path.join(root, 'node_modules/@acme'), { recursive: true });
  symlinkSync(path.join(root, 'packages/theme'), path.join(root, 'node_modules/@acme/theme'), 'dir');

  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-qm', 'uno');
  return root;
}
