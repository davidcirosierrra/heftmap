import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIndex, type HeftIndex } from '../src/core/index.js';
import { exportTargets, loadWorkspace, packageNameOf } from '../src/core/workspace.js';
import { createMonorepo } from './fixture.js';

/**
 * Monorepo (SPEC §4.3): cada app con su tsconfig y sus alias, paquetes del repo importados por
 * nombre, con y sin `node_modules`. Sin esto, casi todo el código salía «sin importadores».
 */
let root: string;
let index: HeftIndex;

const file = (p: string) => {
  const f = index.files.find((x) => x.path === p);
  if (!f) throw new Error(`no está en el índice: ${p}`);
  return f;
};
const importers = (p: string): string[] => file(p).refsIn.filter((r) => r.kind === 'import').map((r) => r.from).sort();

beforeAll(async () => {
  root = createMonorepo();
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
