import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
