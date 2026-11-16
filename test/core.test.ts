import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type FileEntry, type HeftIndex } from '../src/core/index.js';
import { hotspots } from '../src/report.js';
import { createKartGame, createRepo } from './fixture.js';

let root: string;
let index: HeftIndex;
const file = (p: string): FileEntry => {
  const f = index.files.find((x) => x.path === p);
  if (!f) throw new Error(`no está en el índice: ${p}`);
  return f;
};
const usage = (p: string) => file(p).usage;

beforeAll(async () => {
  root = createKartGame();
  index = await buildIndex(root);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('listado', () => {
  it('respeta .gitignore e incluye archivos nuevos', () => {
    expect(index.files.some((f) => f.path.startsWith('node_modules/'))).toBe(false);
    expect(file('src/nuevo.ts').untracked).toBe(true);
  });

  it('cuenta líneas en texto y no en binarios', () => {
    expect(file('src/game/Track.ts').lines).toBe(8);
    expect(file('public/models/circuit.glb').lines).toBeNull();
    expect(file('public/models/circuit.glb').size).toBe(840 * 1024);
  });

  it('incluye ignorados como pseudo-entradas solo si se pide', async () => {
    const withIgnored = await buildIndex(root, { includeIgnored: true });
    const nm = withIgnored.files.find((f) => f.path === 'node_modules');
    expect(nm?.ignoredByGit).toBe(true);
    expect(nm?.usage).toBe('ignored-by-git');
    expect(nm?.size).toBe(5000);
  });
});

describe('git', () => {
  it('último commit y nº de cambios en un solo git log', () => {
    expect(index.commitsRead).toBe(3);
    expect(file('src/game/Physics.ts').changes).toBe(3);
    expect(file('src/game/Physics.ts').lastCommit?.subject).toBe('Añade agarre');
    expect(file('src/game/Kart.ts').changes).toBe(2);
    expect(file('src/game/Track.ts').changes).toBe(1);
  });

  it('marca cambios sin commit', () => {
    expect(file('src/game/Physics.ts').dirty).toBe(true);
    expect(file('src/game/Kart.ts').dirty).toBe(false);
  });

  it('hotspots: más cambios primero, sin generados', () => {
    expect(hotspots(index, 2).map((f) => f.path)).toEqual(['src/game/Physics.ts', 'src/game/Kart.ts']);
  });
});

describe('uso', () => {
  it('resuelve imports relativos, alias de tsconfig e import type', () => {
    const physicsFrom = file('src/game/Physics.ts').refsIn.map((r) => r.from).sort();
    expect(physicsFrom).toEqual(['src/components/Menu.tsx', 'src/game/Kart.ts', 'src/game/Track.ts']);
    expect(file('src/game/Kart.ts').refsIn.map((r) => r.from).sort()).toEqual([
      'src/components/App.tsx',
      'src/components/HUD.tsx',
      'src/game/Camera.ts',
    ]);
  });

  it('resuelve rutas en strings contra public/', () => {
    expect(usage('public/models/circuit.glb')).toBe('referenced');
    expect(file('public/models/circuit.glb').refsIn[0]).toMatchObject({ from: 'src/game/Track.ts', kind: 'ruta en string' });
    expect(usage('public/audio/music.mp3')).toBe('referenced');
  });

  it('resuelve src en HTML, url() en CSS y enlaces en Markdown', () => {
    expect(file('src/main.tsx').refsIn[0]).toMatchObject({ from: 'index.html', kind: 'src/href' });
    expect(file('src/styles/fonts/pixel.woff2').refsIn[0]).toMatchObject({ kind: 'url()' });
    expect(file('docs/shot.png').refsIn[0]).toMatchObject({ from: 'README.md', kind: 'enlace md' });
  });

  it('rutas montadas en ejecución: mencionado, no sin rastro', () => {
    expect(usage('public/textures/grass.png')).toBe('mentioned');
    expect(file('public/textures/grass.png').refsIn[0]).toMatchObject({ from: 'src/game/Track.ts', kind: 'mención' });
  });

  it('sin rastro solo para recursos sin ruta ni nombre', () => {
    const none = index.files.filter((f) => f.usage === 'none').map((f) => f.path).sort();
    expect(none).toEqual(['public/audio/drift.mp3', 'public/models/trees.glb']);
  });

  it('código sin importadores es un aviso aparte', () => {
    expect(usage('src/unused.ts')).toBe('no-importers');
    expect(usage('src/nuevo.ts')).toBe('no-importers');
  });

  it('no cuentan como uso: rutas en comentarios ni código citado en el README', () => {
    // Physics.ts lo cita en un comentario y README.md entre backticks
    expect(file('src/unused.ts').refsIn).toEqual([]);
  });

  it('la imagen del README sí cuenta', () => {
    expect(usage('docs/shot.png')).toBe('referenced');
  });

  it('un script de tooling que nombra un recurso no lo hace «referenciado»', () => {
    expect(file('public/gen/sprite.png').refsIn[0]).toMatchObject({ from: 'scripts/gen.mjs' });
    expect(usage('public/gen/sprite.png')).toBe('mentioned');
  });

  it('puntos de entrada y no analizados', () => {
    expect(usage('index.html')).toBe('entry');
    expect(usage('vite.config.ts')).toBe('entry');
    expect(usage('scripts/gen.mjs')).toBe('referenced'); // vía scripts de package.json
    expect(usage('package.json')).toBe('not-analyzed');
    expect(usage('README.md')).toBe('not-analyzed');
  });

  it('excepciones del usuario', async () => {
    const withIgnore = await buildIndex(root, { ignore: ['public/models/trees.glb'] });
    expect(withIgnore.files.find((f) => f.path === 'public/models/trees.glb')?.usage).toBe('exception');
  });
});

describe('maxTextBytes (ajuste heftmap.maxTextFileSize)', () => {
  it('un texto por encima del límite conserva su tamaño, sin líneas ni uso', async () => {
    const dir = createRepo({
      'src/main.ts': "import { big } from './big'\nexport default big\n",
      'src/big.ts': `export const big = 1\n// ${'x'.repeat(4000)}\n`,
      'public/a.png': 'png',
      'src/refs.ts': `const a = '/a.png'\nexport default a\n${'//'.repeat(3000)}\n`,
    });
    try {
      const small = await buildIndex(dir, { maxTextBytes: 1024 });
      const at = (p: string) => small.files.find((f) => f.path === p)!;
      expect(at('src/big.ts').size).toBeGreaterThan(4000);
      expect(at('src/big.ts').lines).toBeNull();
      // refs.ts no se lee: su ruta a /a.png no cuenta.
      expect(at('public/a.png').usage).toBe('none');

      const normal = await buildIndex(dir);
      const at2 = (p: string) => normal.files.find((f) => f.path === p)!;
      expect(at2('src/big.ts').lines).toBe(2);
      expect(at2('public/a.png').usage).toBe('referenced');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('weakSources (ajuste heftmap.usage.weakSources)', () => {
  let dir: string;
  beforeAll(() => {
    dir = createKartGame();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const usageWith = async (weakSources: string[] | undefined, p: string) =>
    (await buildIndex(dir, weakSources ? { weakSources } : {})).files.find((f) => f.path === p)?.usage;

  it('por defecto scripts/, tools/ y bin/: lo que nombra el generador es mención', async () => {
    expect(await usageWith(undefined, 'public/gen/sprite.png')).toBe('mentioned');
  });

  it('sin carpetas de tooling, lo que nombra el generador cuenta como uso', async () => {
    expect(await usageWith([], 'public/gen/sprite.png')).toBe('referenced');
  });

  it('acepta `./carpeta/` y carpetas anidadas', async () => {
    expect(await usageWith(['./scripts/'], 'public/gen/sprite.png')).toBe('mentioned');
    // HUD solo lo importa App, que está en src/components.
    expect(await usageWith(['src/components'], 'src/components/HUD.tsx')).toBe('mentioned');
    expect(await usageWith(['src/comp'], 'src/components/HUD.tsx')).toBe('referenced');
  });
});

describe('exclude (ajuste heftmap.exclude)', () => {
  let dir: string;
  beforeAll(() => {
    dir = createKartGame();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const paths = (i: HeftIndex): string[] => i.files.map((f) => f.path);

  it('sin `/` casa en cualquier carpeta; una carpeta se lleva su contenido', async () => {
    const i = await buildIndex(dir, { exclude: ['*.mp3', 'textures'] });
    expect(paths(i).some((p) => p.endsWith('.mp3'))).toBe(false);
    expect(paths(i).some((p) => p.startsWith('public/textures/'))).toBe(false);
    expect(paths(i)).toContain('public/models/kart.glb');
  });

  it('con `/` es relativo a la raíz; `./` y `/` final dan igual', async () => {
    const i = await buildIndex(dir, { exclude: ['./src/game/', 'public/models/*.glb'] });
    expect(paths(i).some((p) => p.startsWith('src/game/'))).toBe(false);
    expect(paths(i).some((p) => p.startsWith('public/models/'))).toBe(false);
    expect(paths(i)).toContain('src/main.tsx');
  });

  it('las referencias de lo excluido no cuentan', async () => {
    // Track.ts era quien usaba circuit.glb y sky.png.
    const i = await buildIndex(dir, { exclude: ['src/game/Track.ts'] });
    expect(i.files.find((f) => f.path === 'public/models/circuit.glb')?.usage).toBe('none');
  });

  it('un patrón peligroso se ignora con un aviso', async () => {
    const bad = 'a/**/b/**/c/**/d/**/x';
    const i = await buildIndex(dir, { exclude: [bad, '*.mp3'] });
    expect(i.warnings).toContainEqual({ code: 'invalid-exclude', patterns: [bad] });
    expect(paths(i).some((p) => p.endsWith('.mp3'))).toBe(false);
  });
});
