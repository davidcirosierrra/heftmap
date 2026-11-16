import path from 'node:path';
import ts from 'typescript';
import { toPosix } from '../files.js';
import { MAX_TSCONFIGS } from '../limits.js';
import type { FileEntry } from '../types.js';

/** Resolución de rutas (SPEC §4.3): rutas escritas a mano, módulos con el tsconfig y globs de Vite. */

const posix = path.posix;

export type Resolver = (spec: string, from: string) => string | null;

/** Resuelve una ruta escrita en un archivo a un archivo del índice, o null. */
export function makeResolver(files: Map<string, unknown>, publicDir: string): Resolver {
  // Carpetas públicas existentes (public/, docs/public/, packages/app/public/…)
  const publicDirs = new Set<string>();
  for (const f of files.keys()) {
    const i = f.indexOf(publicDir + '/');
    if (i === 0 || (i > 0 && f[i - 1] === '/')) publicDirs.add(f.slice(0, i + publicDir.length));
  }
  /** Carpetas públicas candidatas para un archivo: las de sus ancestros, de la más cercana a la raíz. */
  const publicDirsFor = (dir: string): string[] => {
    const out: string[] = [];
    let d = dir === '.' ? '' : dir;
    for (;;) {
      const cand = d ? `${d}/${publicDir}` : publicDir;
      if (publicDirs.has(cand)) out.push(cand);
      if (!d) break;
      d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
    }
    if (!out.length) out.push(publicDir);
    return out;
  };
  return (raw, from) => {
    let spec = raw.trim();
    if (!spec || spec.length > 300 || /[\n\r<>|*]/.test(spec)) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('//') || spec.startsWith('#')) return null;
    spec = spec.replace(/[?#].*$/, '');
    try {
      spec = decodeURI(spec);
    } catch {
      // se usa tal cual
    }
    if (!spec || spec === '.' || spec === '..') return null;
    const dir = posix.dirname(from);
    const candidates: string[] = [];
    if (spec.startsWith('/')) {
      // Ruta absoluta: carpeta pública, y después la raíz del proyecto, que en un monorepo es
      // la carpeta de la app (`apps/admin/index.html` → `/src/main.tsx`): se prueban las
      // carpetas de alrededor, de la más cercana a la raíz del repo.
      const ancestors: string[] = [];
      for (let d = dir === '.' ? '' : dir; d; d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') ancestors.push(posix.join(d, spec));
      candidates.push(...publicDirsFor(dir).map((p) => posix.join(p, spec)), ...ancestors, spec.slice(1));
    } else if (spec.startsWith('./') || spec.startsWith('../')) {
      candidates.push(posix.join(dir, spec));
    } else {
      candidates.push(posix.join(dir, spec), ...publicDirsFor(dir).map((p) => posix.join(p, spec)), spec);
    }
    for (const c of candidates) {
      const norm = posix.normalize(c);
      if (norm.startsWith('../') || norm === '..') continue;
      if (files.has(norm)) return norm;
    }
    return null;
  };
}

/**
 * Resolución de módulos con TypeScript y el tsconfig del proyecto (alias `paths`,
 * `baseUrl`, extensiones). Devuelve la ruta relativa, null si resuelve fuera del repo
 * (paquete de node_modules) o undefined si TypeScript no lo resuelve.
 */
interface TsResolver {
  resolve: (spec: string, from: string) => string | null | undefined;
  /** Candidatos (rutas relativas) al aplicar a mano `paths` y `baseUrl` del tsconfig. */
  alias: (spec: string, from: string) => string[];
}

export function makeTsResolver(root: string, files: Map<string, FileEntry>): TsResolver {
  const configs = loadTsConfigs(root, files);
  const fallback: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    resolveJsonModule: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
  };
  const caches = new Map<ts.CompilerOptions, ts.ModuleResolutionCache>();
  // Qué tsconfig manda en cada archivo (monorepos: cada app o paquete trae el suyo, con sus
  // alias). 1.º, el que lo incluye; entre varios, el de la carpeta más profunda. 2.º, el más
  // cercano subiendo carpetas, aunque no lo incluya (tests, scripts fuera de `include`).
  const byFile = new Map<string, TsConfig>();
  const byDir = new Map<string, TsConfig[]>();
  for (const c of configs) {
    for (const f of c.files) {
      const prev = byFile.get(f);
      if (!prev || c.dir.length > prev.dir.length) byFile.set(f, c);
    }
    byDir.set(c.dir, [...(byDir.get(c.dir) ?? []), c]);
  }
  const nearest = new Map<string, TsConfig | null>();
  const nearestConfig = (absDir: string): TsConfig | null => {
    const hit = nearest.get(absDir);
    if (hit !== undefined) return hit;
    const here = byDir.get(absDir);
    // En una carpeta con varios (tsconfig.app.json, tsconfig.node.json), el que define alias.
    let found: TsConfig | null = here ? (here.find((c) => c.options.paths || c.options.baseUrl) ?? here[0] ?? null) : null;
    if (!found) {
      const parent = path.dirname(absDir);
      found = parent !== absDir && absDir.length > root.length ? nearestConfig(parent) : null;
    }
    nearest.set(absDir, found);
    return found;
  };
  const optionsFor = (absFile: string): ts.CompilerOptions => {
    const including = byFile.get(absFile);
    const near = nearestConfig(path.dirname(absFile));
    // Una base en la raíz «incluye» todo el repo: si hay una configuración más cerca del
    // archivo, manda esa aunque no lo liste.
    const chosen = including && (!near || including.dir.length >= near.dir.length) ? including : near;
    return chosen?.options ?? fallback;
  };
  const toRel = (abs: string): string => toPosix(path.relative(root, abs));
  const inIndex = (rel: string): boolean => {
    const f = files.get(rel);
    return !!f && !f.ignoredByGit;
  };
  const alias = (spec: string, from: string): string[] => {
    const clean = spec.replace(/(?!^)[?#].*$/, '');
    if (!clean || clean.startsWith('.') || clean.startsWith('/')) return [];
    const options = optionsFor(path.join(root, from));
    // `pathsBasePath`: carpeta del tsconfig cuando hay `paths` sin `baseUrl` (campo interno de TS).
    const base = options.baseUrl ?? (options as { pathsBasePath?: string }).pathsBasePath;
    const out: string[] = [];
    if (base) {
      for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
        const star = pattern.indexOf('*');
        let captured: string | null = null;
        if (star < 0) {
          if (clean === pattern) captured = '';
        } else {
          const pre = pattern.slice(0, star);
          const post = pattern.slice(star + 1);
          if (clean.length >= pre.length + post.length && clean.startsWith(pre) && clean.endsWith(post)) {
            captured = clean.slice(pre.length, clean.length - post.length);
          }
        }
        if (captured === null) continue;
        for (const t of targets) out.push(toRel(path.resolve(base, t.replace('*', captured))));
      }
    }
    if (options.baseUrl) out.push(toRel(path.resolve(options.baseUrl, clean)));
    return out.filter((r) => r && !r.startsWith('..'));
  };
  const resolve = (spec: string, from: string): string | null | undefined => {
    const absFrom = path.join(root, from);
    const options = optionsFor(absFrom);
    let cache = caches.get(options);
    if (!cache) {
      cache = ts.createModuleResolutionCache(root, (x) => x, options);
      caches.set(options, cache);
    }
    const { resolvedModule } = ts.resolveModuleName(spec, absFrom, options, ts.sys, cache);
    if (!resolvedModule) return undefined;
    const rel = toRel(resolvedModule.resolvedFileName);
    // Un archivo del propio repo es interno aunque se llegue a él por `node_modules` (enlace
    // de workspace): TypeScript lo marca como librería externa, pero es código nuestro.
    if (!rel.startsWith('..') && inIndex(rel)) return rel;
    if (rel.startsWith('..')) return null;
    // Dentro del repo pero fuera del índice: casi siempre el `dist/` compilado de un paquete
    // del monorepo (ignorado por git, existe tras un build). No es el destino: que lo busquen
    // el workspace y los alias en el código fuente. Antes se devolvía esta ruta, `add()` la
    // descartaba y el `src/` quedaba «sin importadores».
    return resolvedModule.isExternalLibraryImport ? null : undefined;
  };
  return { resolve, alias };
}

interface TsConfig {
  /** Carpeta (absoluta) del archivo de configuración. */
  dir: string;
  options: ts.CompilerOptions;
  files: Set<string>;
}

/**
 * Todos los `tsconfig*.json` y `jsconfig.json` del repo (no solo el de la raíz), más los que
 * estos nombren en `references`. De la raíz hacia dentro.
 */
function loadTsConfigs(root: string, files: Map<string, FileEntry>): TsConfig[] {
  const result: TsConfig[] = [];
  const visited = new Set<string>();
  const load = (configPath: string): void => {
    if (visited.has(configPath) || visited.size >= MAX_TSCONFIGS || !ts.sys.fileExists(configPath)) return;
    visited.add(configPath);
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) return;
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath), undefined, configPath);
    const options = { ...parsed.options };
    options.moduleResolution ??= ts.ModuleResolutionKind.Bundler;
    options.allowJs ??= true;
    options.resolveJsonModule ??= true;
    options.allowImportingTsExtensions ??= true;
    options.noEmit = true;
    // También los de «solución» (sin archivos propios): pueden ser el más cercano de alguien.
    result.push({ dir: path.dirname(configPath), options, files: new Set(parsed.fileNames.map((f) => path.resolve(f))) });
    for (const ref of parsed.projectReferences ?? []) {
      const p = ref.path.endsWith('.json') ? ref.path : path.join(ref.path, 'tsconfig.json');
      load(path.resolve(path.dirname(configPath), p));
    }
  };
  const found = [...files.values()]
    .filter((f) => !f.ignoredByGit && /^(?:tsconfig(?:\.[\w-]+)?|jsconfig)\.json$/.test(posix.basename(f.path)) && !/(^|\/)node_modules\//.test(f.path))
    .map((f) => f.path)
    // De menos a más anidado y, en cada carpeta, `tsconfig.json` antes que sus variantes.
    .sort((a, b) => a.split('/').length - b.split('/').length || posix.basename(a).length - posix.basename(b).length || a.localeCompare(b));
  for (const rel of found) load(path.join(root, rel));
  return result;
}

// Los globs viven en ../glob.ts (también los usa `heftmap.exclude`); se reexportan por compatibilidad.
export { escapeRe, globToRegExp } from '../glob.js';
