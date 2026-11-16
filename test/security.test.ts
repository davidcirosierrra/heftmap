import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildIndex } from '../src/core/index.js';
import { findGit } from '../src/core/git.js';
import { cssUrls, globToRegExp, htmlAttrs, mdLinks, quotedStrings } from '../src/core/usage.js';

/**
 * Seguridad (docs/seguridad.md): un repo malicioso no debe ejecutar código, colgar el análisis
 * ni hacer que Heft lea fuera de él.
 */
const dirs: string[] = [];
const tmp = (name: string): string => {
  const d = mkdtempSync(path.join(tmpdir(), `heft-sec-${name}-`));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const sh = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' },
  });
};

/** Repo con un `.git/config` que intenta ejecutar un programa y deja una marca si lo consigue. */
function maliciousRepo(): { root: string; marker: string } {
  const root = tmp('repo');
  const marker = path.join(tmp('marker'), 'pwned');
  const payload = path.join(tmp('bin'), 'payload.sh');
  writeFileSync(payload, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  chmodSync(payload, 0o755);
  writeFileSync(path.join(root, 'a.ts'), 'export const a = 1\n');
  sh(root, 'init', '-q');
  sh(root, 'add', '.');
  sh(root, 'commit', '-qm', 'uno');
  // Lo que traería un repo descargado (no clonado): config hostil.
  sh(root, 'config', 'core.fsmonitor', payload);
  sh(root, 'config', 'log.showSignature', 'true');
  sh(root, 'config', 'gpg.program', payload);
  return { root, marker };
}

describe('seguridad: git', () => {
  it('ni core.fsmonitor ni la verificación de firmas ejecutan nada', async () => {
    const { root, marker } = maliciousRepo();
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 2\n'); // cambio sin commit: git status trabaja
    const index = await buildIndex(root);
    expect(index.isGit).toBe(true);
    expect(index.files.find((f) => f.path === 'a.ts')?.dirty).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it('sin confianza (useGit: false) no se ejecuta git en absoluto, ni con un filtro en .gitattributes', async () => {
    const { root, marker } = maliciousRepo();
    const payload = path.join(path.dirname(path.dirname(marker)), 'x');
    void payload;
    sh(root, 'config', 'filter.evil.clean', `touch '${marker}'; cat`);
    writeFileSync(path.join(root, '.gitattributes'), '*.ts filter=evil\n');
    writeFileSync(path.join(root, 'b.ts'), 'export const b = 1\n');
    const index = await buildIndex(root, { useGit: false });
    expect(index.isGit).toBe(false);
    expect(index.commitsRead).toBe(0);
    expect(index.files.map((f) => f.path).sort()).toEqual(['.gitattributes', 'a.ts', 'b.ts']);
    expect(existsSync(marker)).toBe(false);
  });

  it('git se busca en el PATH sin mirar la carpeta analizada ni rutas relativas', () => {
    const repo = tmp('planted');
    const planted = path.join(repo, 'tools');
    mkdirSync(planted);
    writeFileSync(path.join(planted, 'git'), '#!/bin/sh\n');
    chmodSync(path.join(planted, 'git'), 0o755);
    const realDir = tmp('realbin');
    writeFileSync(path.join(realDir, 'git'), '#!/bin/sh\n');
    chmodSync(path.join(realDir, 'git'), 0o755);
    const PATH = ['.', 'tools', planted, repo, realDir].join(':');
    expect(findGit(repo, { PATH }, 'linux')).toBe(path.join(realDir, 'git'));
    expect(findGit(repo, { PATH: ['.', planted].join(':') }, 'linux')).toBeNull();
  });

  it('en Windows solo vale git.exe, nunca un .cmd, y nunca dentro del repo', () => {
    const repo = 'C:\\proyectos\\malo';
    // findGit consulta el disco: sin un git.exe real en estas rutas no encuentra ninguno.
    expect(findGit(repo, { Path: `C:\\proyectos\\malo;C:\\proyectos\\malo\\bin;.` }, 'win32')).toBeNull();
  });
});

describe('seguridad: lectura de archivos', () => {
  it('un enlace simbólico que apunta fuera del repo no se lee', async () => {
    const outside = tmp('outside');
    writeFileSync(path.join(outside, 'secreto.ts'), "import './robado'\nconst k = 'clave'\n".repeat(10));
    const root = tmp('links');
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 1\n');
    symlinkSync(path.join(outside, 'secreto.ts'), path.join(root, 'enlace.ts'));
    const index = await buildIndex(root, { useGit: false });
    // El recorrido sin git no entra en enlaces; con git, el enlace cuenta como enlace.
    expect(index.files.find((f) => f.path === 'enlace.ts')).toBeUndefined();
    sh(root, 'init', '-q');
    sh(root, 'add', '.');
    sh(root, 'commit', '-qm', 'uno');
    const withGit = await buildIndex(root);
    const link = withGit.files.find((f) => f.path === 'enlace.ts');
    expect(link).toBeDefined();
    expect(link!.lines).toBeNull();
    expect(link!.size).toBeLessThan(200);
    expect(link!.refsOut).toEqual([]);
  });
});

describe('seguridad: expresiones regulares con contenido hostil (ReDoS)', () => {
  const MB = 1_000_000;
  const fast = (name: string, fn: () => unknown): void => {
    const t0 = performance.now();
    fn();
    expect(performance.now() - t0, name).toBeLessThan(2000);
  };

  it('extractores: lineales con miles de aperturas sin cerrar', () => {
    fast('url(', () => cssUrls('url('.repeat(MB / 4)));
    fast('@import', () => cssUrls("@import '".repeat(MB / 9)));
    fast('src=', () => htmlAttrs('src="'.repeat(MB / 5)));
    fast('[', () => mdLinks('['.repeat(MB)));
    fast('[a](', () => mdLinks('[a]('.repeat(MB / 4)));
    fast('comillas', () => quotedStrings('"' + 'a'.repeat(MB)));
  });

  it('siguen encontrando lo normal', () => {
    expect(cssUrls("a { background: url('/img/x.png') } @import \"b.css\";")).toEqual(['/img/x.png', 'b.css']);
    expect(mdLinks('![logo](docs/logo.png "Logo") y [guía](guia.md)')).toEqual(['docs/logo.png', 'guia.md']);
  });

  it('patrones de import.meta.glob: los peligrosos se rechazan, los normales funcionan', () => {
    expect(globToRegExp('a**b**c**d**e')).toBeNull();
    expect(globToRegExp('x'.repeat(400))).toBeNull();
    // `**/` repetidos se juntan en uno: mismo significado, sin retroceso exponencial.
    const re = globToRegExp('**/'.repeat(14) + '*.ts')!;
    const t0 = performance.now();
    expect(re.test('a/'.repeat(40) + 'b.png')).toBe(false);
    expect(re.test('a/b/c.ts')).toBe(true);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(globToRegExp('./assets/**/*.{png,jpg}')!.test('./assets/a/b.png')).toBe(true);
  });
});
