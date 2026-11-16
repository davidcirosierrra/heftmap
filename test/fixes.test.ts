import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { categorize } from '../src/core/classify.js';
import { buildIndex, type FileEntry, type HeftIndex } from '../src/core/index.js';
import { globToRegExp, scanCode } from '../src/core/usage.js';
import { createRepo } from './fixture.js';

/** Falsos veredictos encontrados en la revisión de código de las fases 0 y 1. */
let root: string;
let index: HeftIndex;
const file = (p: string): FileEntry => {
  const f = index.files.find((x) => x.path === p);
  if (!f) throw new Error(`no está en el índice: ${p}`);
  return f;
};
const png = Buffer.alloc(2048, 7);

beforeAll(async () => {
  root = createRepo({
    'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', paths: { '@/*': ['./src/*'] } }, include: ['src'] }),
    'index.html': '<script type="module" src="/src/main.ts"></script>\n',
    'biome.json': '{}',
    'components.json': '{}',
    'apps/web/renovate.json': '{}',
    'apps/web/staticwebapp.config.json': '{}',
    'public/manifest.json': JSON.stringify({ icons: [{ src: '/icon.png' }] }),
    'public/icon.png': png,
    'src/data/levels.json': '{"levels":[]}',
    'src/data/zqxold.json': '{}',
    'src/main.ts': [
      `import logo from '@/assets/logo.png'`,
      `import shader from '@/assets/wave.glsl?raw'`,
      `import levels from './data/levels.json'`,
      `const sprites = import.meta.glob('./sprites/**/*.png')`,
      `const sounds = import.meta.glob(['@/sounds/*.{mp3,ogg}', '!**/*mute.*'], { eager: true })`,
      `console.log(logo, shader, levels, sprites, sounds)`,
      '',
    ].join('\n'),
    'src/assets/logo.png': png,
    'src/assets/wave.glsl': 'void main() {}\n',
    'src/sprites/hero/zqxrun.png': png,
    'src/sprites/zqxidle.png': png,
    'src/sounds/zqxjump.mp3': png,
    'src/sounds/zqxhit.ogg': png,
    'src/sounds/zqxmute.mp3': png,
    'src/sounds/zqxnotes.wav': png,
  });
  index = await buildIndex(root);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('JSON de configuración', () => {
  it('en la raíz o con nombre de herramienta no es un recurso «sin rastro»', () => {
    for (const p of ['biome.json', 'components.json', 'apps/web/renovate.json', 'apps/web/staticwebapp.config.json']) {
      expect(file(p).category, p).toBe('config');
      expect(file(p).usage, p).toBe('not-analyzed');
    }
  });

  it('los JSON de datos siguen siendo recursos y se juzgan', () => {
    expect(file('src/data/levels.json').usage).toBe('referenced');
    expect(file('src/data/zqxold.json').usage).toBe('none');
  });

  it('el manifest PWA sigue siendo origen de referencias', () => {
    expect(categorize('manifest.json')).toBe('resource');
    expect(file('public/icon.png').refsIn.map((r) => r.from)).toContain('public/manifest.json');
  });
});

describe('alias del tsconfig hacia recursos', () => {
  it('un import con alias de un recurso es «referenciado», no «mencionado»', () => {
    expect(file('src/assets/logo.png').usage).toBe('referenced');
    expect(file('src/assets/logo.png').refsIn[0]).toMatchObject({ from: 'src/main.ts', kind: 'import' });
  });

  it('también con sufijo de Vite (?raw, ?url)', () => {
    expect(file('src/assets/wave.glsl').refsIn[0]).toMatchObject({ from: 'src/main.ts', kind: 'import' });
  });
});

describe('import.meta.glob', () => {
  it('lo que casa con el patrón es «referenciado»', () => {
    for (const p of ['src/sprites/hero/zqxrun.png', 'src/sprites/zqxidle.png']) {
      expect(file(p).usage, p).toBe('referenced');
      expect(file(p).refsIn[0], p).toMatchObject({ from: 'src/main.ts', kind: 'import.meta.glob' });
    }
  });

  it('array de patrones con alias, llaves y exclusiones', () => {
    expect(file('src/sounds/zqxjump.mp3').usage).toBe('referenced');
    expect(file('src/sounds/zqxhit.ogg').usage).toBe('referenced');
    expect(file('src/sounds/zqxmute.mp3').usage).toBe('none'); // excluido con «!»
    expect(file('src/sounds/zqxnotes.wav').usage).toBe('none'); // la extensión no casa
  });

  it('extrae los patrones del AST y traduce el glob', () => {
    expect(scanCode(`const a = import.meta.glob('./a/*.png'); const b = other.glob('./b/*')`, 'x.ts').globs).toEqual([['./a/*.png']]);
    expect(globToRegExp('src/**/*.png')!.test('src/a.png')).toBe(true);
    expect(globToRegExp('src/**/*.png')!.test('src/a/b/c.png')).toBe(true);
    expect(globToRegExp('src/*.png')!.test('src/a/b.png')).toBe(false);
    expect(globToRegExp('src/*.{mp3,ogg}')!.test('src/a.ogg')).toBe(true);
    expect(globToRegExp('src/a.png')!.test('src/aXpng')).toBe(false);
  });
});

describe('avisos de git', () => {
  it('sin git en el PATH se avisa en vez de degradar en silencio', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'heft-nogit-'));
    writeFileSync(path.join(dir, 'a.txt'), 'hola\n');
    const saved = process.env.PATH;
    process.env.PATH = '';
    try {
      const idx = await buildIndex(dir);
      expect(idx.isGit).toBe(false);
      expect(idx.warnings).toContainEqual({ code: 'no-git' });
    } finally {
      process.env.PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('una carpeta que no es un repo no genera aviso', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'heft-plain-'));
    writeFileSync(path.join(dir, 'a.txt'), 'hola\n');
    try {
      const idx = await buildIndex(dir);
      expect(idx.isGit).toBe(false);
      expect(idx.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
