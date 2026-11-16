import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type HeftIndex } from '../src/core/index.js';
import { exportTargets, loadWorkspace, packageNameOf } from '../src/core/workspace.js';

/**
 * Monorepo (SPEC §4.3): cada app con su tsconfig y sus alias, paquetes del repo importados por
 * nombre, con y sin `node_modules`. Sin esto, casi todo el código salía «sin importadores».
 */
let root: string;
let index: HeftIndex;

const write = (rel: string, content: string | object): void => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
};
const file = (p: string) => {
  const f = index.files.find((x) => x.path === p);
  if (!f) throw new Error(`no está en el índice: ${p}`);
  return f;
};
const importers = (p: string): string[] => file(p).refsIn.filter((r) => r.kind === 'import').map((r) => r.from).sort();

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'heft-mono-'));
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
  index = await buildIndex(root);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('monorepo: tsconfig de cada app', () => {
  it('el alias @/ de la app móvil resuelve con SU tsconfig, sin tsconfig en la raíz', () => {
    expect(importers('apps/mobile/src/hooks/useTrip.ts')).toEqual(['apps/mobile/src/main.tsx']);
    expect(file('apps/mobile/src/hooks/useTrip.ts').usage).toBe('referenced');
  });

  it('un archivo fuera del `include` usa el tsconfig más cercano', () => {
    expect(importers('apps/mobile/src/lib/http.ts')).toEqual(['apps/mobile/e2e/flow.ts', 'apps/mobile/src/hooks/useTrip.ts']);
  });

  it('el mismo alias en otra app va a otro sitio; también `baseUrl` y tsconfig de solución con references', () => {
    expect(importers('apps/web/app/page.ts')).toEqual(['apps/web/src/index.ts']);
    expect(importers('apps/web/src/components/Card.ts')).toEqual(['apps/web/src/index.ts']);
  });

  it('el index.html de una app es su entrada, y sus rutas absolutas parten de la carpeta de la app', () => {
    expect(file('apps/web/index.html').usage).toBe('entry');
    expect(file('apps/web/src/index.ts').refsIn.map((r) => `${r.from} (${r.kind})`)).toEqual(['apps/web/index.html (src/href)']);
    expect(file('apps/web/src/index.ts').usage).toBe('referenced');
  });

  it('lo que de verdad nadie importa sigue saliendo «sin importadores»', () => {
    expect(file('apps/mobile/src/huerfano.ts').usage).toBe('no-importers');
  });
});

describe('monorepo: paquetes del repo', () => {
  it('sin node_modules: `main` apunta a dist/, se va al fuente', () => {
    expect(importers('packages/api/src/index.ts')).toEqual(['apps/mobile/src/main.tsx', 'apps/web/src/index.ts']);
    expect(file('packages/api/src/client.ts').usage).toBe('referenced');
  });

  it('subpaths: por patrón de `exports` hacia dist/ y por carpeta', () => {
    expect(importers('packages/ui/src/Button.tsx')).toContain('apps/mobile/src/main.tsx');
    expect(importers('packages/api/src/internal/deep.ts')).toEqual(['apps/mobile/src/main.tsx']);
  });

  it('paquete sin `main` ni `exports`: src/index', () => {
    expect(importers('packages/types/src/index.ts')).toEqual(['apps/mobile/src/main.tsx']);
  });

  it('con el enlace en node_modules: es código del repo, no una librería externa', () => {
    expect(importers('packages/theme/src/index.ts')).toEqual(['apps/mobile/src/main.tsx']);
    expect(index.files.some((f) => f.path.startsWith('node_modules/') && !f.ignoredByGit)).toBe(false);
  });

  it('con el paquete compilado: TypeScript llega a dist/ (ignorado) y se va al fuente', () => {
    expect(importers('packages/kit/src/i18n/index.ts')).toEqual(['apps/mobile/src/main.tsx']);
    expect(file('packages/kit/src/i18n/index.ts').usage).toBe('referenced');
  });

  it('un patrón `./src/*.ts` (de `exports` o de `paths`) también llega a una carpeta con index', () => {
    expect(importers('packages/kit/src/locale/index.ts')).toEqual(['apps/mobile/src/main.tsx']);
    expect(importers('packages/kit/src/format/index.ts')).toEqual(['apps/mobile/src/main.tsx']);
  });

  it('la entrada declarada de un paquete es punto de entrada, también `bin` hacia dist/', () => {
    expect(file('packages/cli/src/bin.ts').usage).toBe('entry');
    // Importada además por otros: «referenciado» gana a «punto de entrada».
    expect(file('packages/api/src/index.ts').usage).toBe('referenced');
  });

  it('los scripts de un package.json anidado se resuelven desde su carpeta', () => {
    expect(file('packages/cli/tools-local/gen.mjs').refsIn.map((r) => `${r.from} (${r.kind})`)).toEqual(['packages/cli/package.json (script npm)']);
  });
});

describe('monorepo: aviso de alias sin resolver', () => {
  it('cuenta los alias que no se saben resolver, no las dependencias ni los módulos de Node', () => {
    const w = index.warnings.find((x) => x.code === 'unresolved-aliases');
    expect(w).toEqual({ code: 'unresolved-aliases', count: 1, prefixes: ['~/… (1)'] });
  });
});

describe('paquetes del repo: piezas', () => {
  it('nombre del paquete de un import', () => {
    expect(['@acme/ui/Button', '@acme/ui', 'lodash/fp', 'react'].map(packageNameOf)).toEqual(['@acme/ui', '@acme/ui', 'lodash', 'react']);
  });

  it('`exports`: cadena, condiciones (fuente primero), subpaths y patrones', () => {
    expect(exportTargets('./src/index.ts', '.')).toEqual(['./src/index.ts']);
    expect(exportTargets({ import: './dist/a.mjs', types: './dist/a.d.ts', source: './src/a.ts' }, '.')).toEqual(['./src/a.ts', './dist/a.d.ts', './dist/a.mjs']);
    expect(exportTargets({ '.': './i.js', './x': './x.js' }, './x')).toEqual(['./x.js']);
    expect(exportTargets({ './*': './dist/*.js' }, './a/b')).toEqual(['./dist/a/b.js']);
    expect(exportTargets({ '.': './i.js' }, './no')).toEqual([]);
    expect(exportTargets({ '.': null }, '.')).toEqual([]);
  });

  it('nombre repetido: gana el paquete menos anidado; package.json roto no rompe nada', () => {
    const files = new Map(['a/package.json', 'ejemplos/x/a/package.json', 'roto/package.json', 'a/src/index.ts', 'ejemplos/x/a/index.js'].map((p) => [p, {}]));
    const texts = new Map([
      ['a/package.json', '{"name":"a"}'],
      ['ejemplos/x/a/package.json', '{"name":"a"}'],
      ['roto/package.json', '{ no es json'],
    ]);
    const ws = loadWorkspace(files, texts);
    expect(ws.resolve('a')).toBe('a/src/index.ts');
    expect(ws.resolve('otro')).toBeUndefined();
    expect(ws.resolve('a/no/existe')).toBeNull();
  });
});
