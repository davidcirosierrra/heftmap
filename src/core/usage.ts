import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { COMPONENT_EXT, extOf } from './classify.js';
import { toPosix } from './files.js';
import type { FileEntry, Phase, Ref, RefKind, Warning } from './types.js';
import { loadWorkspace, packageNameOf, probeFile, type Workspace } from './workspace.js';

/**
 * Grafo de uso (SPEC §4.3), en dos pasadas:
 *  1. Rutas: imports TS/JS resueltos con el tsconfig, strings con pinta de ruta,
 *     `url()` en CSS, `src`/`href` en HTML, enlaces en Markdown y scripts de package.json.
 *  2. Menciones: recursos sin referencia cuyo nombre aparece en algún archivo de texto.
 *
 * Nota: el `typescript` del proyecto analizado puede ser la 7 (nativa, sin API de
 * compilador). Heft usa su propia copia de TypeScript 5.x solo para leer imports.
 */

const posix = path.posix;
const CODE_EXT = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']);
const NODE_BUILTINS = new Set(builtinModules);

export interface UsageInput {
  root: string;
  files: Map<string, FileEntry>;
  texts: Map<string, string>;
  /** Archivos que se leen como origen de referencias. */
  sources: string[];
  publicDir: string;
  /** Paquetes del repo; si no se pasa, se calcula aquí. */
  workspace?: Workspace;
  onProgress?: (phase: Phase, done: number, total: number) => void;
}

export interface UsageResult {
  refs: Ref[];
  warnings: Warning[];
}

export function analyzeUsage(input: UsageInput): UsageResult {
  const { root, files, texts, sources, publicDir, onProgress } = input;
  const refs: Ref[] = [];
  const seen = new Set<string>();
  const warnings: Warning[] = [];
  const unresolved: string[] = [];
  /** Imports no relativos que no son ni dependencia ni paquete del repo: alias sin resolver. */
  const unresolvedAliases = new Map<string, number>();

  const add = (from: string, to: string | null, kind: RefKind): void => {
    if (!to || to === from || !files.has(to)) return;
    const key = `${from}\0${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ from, to, kind });
  };

  const resolve = makeResolver(files, publicDir);
  const tsc = makeTsResolver(root, files);
  const workspace = input.workspace ?? loadWorkspace(files, texts);

  /**
   * Destino de un import: TypeScript primero; si no lo resuelve (recursos: TS no sigue
   * `paths` hacia extensiones que no son suyas), ruta directa y, por último, alias a mano.
   */
  const importTarget = (spec: string, from: string): string | null => {
    const viaTs = tsc.resolve(spec, from);
    if (viaTs) return viaTs;
    // Paquete del propio repo: aunque no haya `node_modules`, o aunque TypeScript lo resuelva
    // a su `dist/` (que no está en el índice), se va a su código fuente.
    const viaWorkspace = workspace.resolve(spec);
    if (viaWorkspace) return viaWorkspace;
    if (viaTs === null) return null; // librería externa
    return resolve(spec, from) ?? firstFile(tsc.alias(spec, from));
  };
  const inRepo = (p: string): boolean => {
    const f = files.get(p);
    return !!f && !f.ignoredByGit;
  };
  /** El primer candidato de alias que es un archivo, probando extensiones y `index` (`#ui/x` → `src/x/index.ts`). */
  const firstFile = (candidates: string[]): string | null => {
    for (const c of candidates) {
      const hit = probeFile(inRepo, c);
      if (hit) return hit;
    }
    return null;
  };

  /**
   * Un import no relativo sin destino que no es una dependencia declarada, ni un módulo de
   * Node, ni un módulo virtual: casi seguro un alias que Heft no sabe resolver (definido solo
   * en el bundler) o un paquete del repo cuyo archivo de entrada no se encuentra.
   */
  const isUnresolvedAlias = (spec: string, from: string): boolean => {
    if (spec.startsWith('/') || spec.includes(':') || /^[\w@~#$-]/.test(spec) === false) return false;
    const name = packageNameOf(spec);
    if (workspace.packages.has(name)) return workspace.resolve(spec) === null;
    if (workspace.declared.has(name) || NODE_BUILTINS.has(name)) return false;
    // Resuelto por TypeScript a una librería de `node_modules`, aunque nadie la declare.
    return tsc.resolve(spec, from) === undefined;
  };

  /** Archivos del índice que casan con los patrones de un `import.meta.glob`. */
  const globTargets = (patterns: string[], from: string): string[] => {
    const dir = posix.dirname(from);
    const expand = (p: string): string[] => {
      if (p.startsWith('/')) return [p.slice(1)];
      if (p.startsWith('./') || p.startsWith('../')) return [posix.normalize(posix.join(dir, p))];
      const viaAlias = tsc.alias(p, from);
      return viaAlias.length ? viaAlias : [posix.normalize(posix.join(dir, p))];
    };
    const toRes = (list: string[]): RegExp[] => list.flatMap(expand).map(globToRegExp).filter((re): re is RegExp => re !== null);
    const yes = toRes(patterns.filter((p) => !p.startsWith('!')));
    const no = toRes(patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1)));
    if (!yes.length) return [];
    const out: string[] = [];
    for (const f of files.keys()) {
      if (yes.some((re) => re.test(f)) && !no.some((re) => re.test(f))) out.push(f);
    }
    return out;
  };

  let scanned = 0;
  onProgress?.('usage', 0, sources.length);
  for (const from of sources) {
    onProgress?.('usage', ++scanned, sources.length);
    const text = texts.get(from);
    if (text == null) continue;
    const ext = extOf(from);
    const base = posix.basename(from);

    if (base === 'package.json') {
      for (const to of packageJsonRefs(text, resolve, from)) add(from, to, 'script npm');
      continue;
    }
    if (COMPONENT_EXT.has(ext)) {
      // .vue/.svelte/.astro: imports del bloque <script>, atributos de la plantilla y strings.
      for (const spec of ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName)) {
        add(from, importTarget(spec, from), 'import');
      }
      for (const spec of htmlAttrs(text)) add(from, resolve(spec, from), 'src/href');
      for (const spec of quotedStrings(text)) add(from, resolve(spec, from), 'ruta en string');
      continue;
    }
    if (CODE_EXT.has(ext)) {
      for (const spec of tsImports(text, ext)) {
        const to = importTarget(spec, from);
        if (to) add(from, to, 'import');
        else if (spec.startsWith('./') || spec.startsWith('../')) unresolved.push(`${from} → ${spec}`);
        else if (isUnresolvedAlias(spec, from)) {
          const prefix = `${spec.split('/')[0]}${spec.includes('/') ? '/…' : ''}`;
          unresolvedAliases.set(prefix, (unresolvedAliases.get(prefix) ?? 0) + 1);
        }
      }
      // Strings del AST: sin comentarios (un JSDoc que cita una ruta no es uso).
      const scan = scanCode(text, from);
      for (const spec of scan.strings) add(from, resolve(spec, from), 'ruta en string');
      for (const patterns of scan.globs) {
        for (const to of globTargets(patterns, from)) add(from, to, 'import.meta.glob');
      }
      continue;
    }
    if (ext === 'md' || ext === 'mdx') {
      // En Markdown solo cuentan los enlaces, y solo hacia recursos y otros documentos:
      // citar `src/x.ts` en el README no demuestra que el código se use.
      for (const spec of [...mdLinks(text), ...htmlAttrs(text)]) {
        const to = resolve(spec, from);
        const cat = to ? files.get(to)?.category : undefined;
        if (cat === 'resource' || cat === 'doc') add(from, to, 'enlace md');
      }
      continue;
    }
    if (files.get(from)?.category === 'doc') continue; // .txt, .rst…: solo para menciones
    if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') {
      for (const spec of cssUrls(text)) add(from, resolve(spec, from), 'url()');
    } else if (ext === 'html' || ext === 'htm' || ext === 'svg') {
      for (const spec of htmlAttrs(text)) add(from, resolve(spec, from), 'src/href');
    }
    for (const spec of quotedStrings(text)) add(from, resolve(spec, from), 'ruta en string');
  }

  // 2.ª pasada: menciones, solo para recursos todavía sin referencia (SPEC §3.3).
  const referenced = new Set(refs.map((r) => r.to));
  const haystack = sources.filter((s) => texts.has(s));
  const pending = [...files.values()].filter((f) => f.category === 'resource' && !f.ignoredByGit && !referenced.has(f.path));
  let searched = 0;
  if (pending.length) onProgress?.('mentions', 0, pending.length);
  for (const f of pending) {
    onProgress?.('mentions', ++searched, pending.length);
    const base = posix.basename(f.path);
    const stem = base.replace(/\.[^.]+$/, '');
    // El nombre completo («grass.png») vale en cualquier sitio. La raíz sola («grass») solo
    // como string entero o tras una barra: `['asphalt', 'grass']` → `/textures/${s}.png`.
    // Suelta por el texto daba falsos «usa» con palabras comunes (`placeholder="Buscar"`),
    // y como clave de objeto (`"placeholder": "Buscar"` en un JSON de traducciones) tampoco.
    // Raíces de 1-2 letras («a.png», «bg.png») se ignoran: casarían en cualquier parte.
    const parts = [`(?<![\\w-])${escapeRe(base)}(?![\\w-])`];
    if (stem.length >= 3 && stem !== base) parts.push(`(?<=['"\`/])${escapeRe(stem)}(?=['"\`](?!\\s*:))`);
    const re = new RegExp(parts.join('|'));
    for (const src of haystack) {
      if (src === f.path) continue;
      if (re.test(texts.get(src) ?? '')) add(src, f.path, 'mención');
    }
  }

  if (unresolved.length) {
    warnings.push({ code: 'unresolved-imports', count: unresolved.length, examples: unresolved.slice(0, 3) });
  }
  if (unresolvedAliases.size) {
    const ranked = [...unresolvedAliases.entries()].sort((a, b) => b[1] - a[1]);
    warnings.push({
      code: 'unresolved-aliases',
      count: ranked.reduce((s, [, n]) => s + n, 0),
      prefixes: ranked.slice(0, 5).map(([prefix, n]) => `${prefix} (${n})`),
    });
  }
  return { refs, warnings };
}

// ---------------------------------------------------------------------------
// Resolución de rutas

type Resolver = (spec: string, from: string) => string | null;

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

function makeTsResolver(root: string, files: Map<string, FileEntry>): TsResolver {
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

/** Más configuraciones que esto no se leen: cada una recorre su carpeta en disco. */
const MAX_TSCONFIGS = 300;

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

// ---------------------------------------------------------------------------
// Extractores

export function tsImports(text: string, ext: string): string[] {
  const info = ts.preProcessFile(text, true, true);
  const specs = info.importedFiles.map((f) => f.fileName);
  // preProcessFile solo ve import() con literal; con template sin `${}` también vale.
  for (const m of text.matchAll(/\bimport\s*\(\s*`([^`$]+)`\s*\)/g)) if (m[1]) specs.push(m[1]);
  // Referencias de tipo /// <reference path> solo en TS
  if (ext.startsWith('ts') || ext.endsWith('ts')) for (const r of info.referencedFiles) specs.push(r.fileName);
  return specs;
}

const looksLikePath = (s: string): boolean => {
  const clean = s.replace(/[?#].*$/, '');
  return clean.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(clean);
};

/** Literales de string en código TS/JS (incluye atributos JSX), leídos del AST. */
export function codeStrings(text: string, fileName: string): string[] {
  return scanCode(text, fileName).strings;
}

/**
 * Una sola pasada por el AST: strings con pinta de ruta y los patrones de cada
 * `import.meta.glob(...)` de Vite (un string o un array; los que empiezan por `!` excluyen).
 */
export function scanCode(text: string, fileName: string): { strings: string[]; globs: string[][] } {
  const ext = extOf(fileName);
  const kind = ext === 'tsx' ? ts.ScriptKind.TSX : ext === 'jsx' ? ts.ScriptKind.JSX : ext.includes('ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  const strings: string[] = [];
  const globs: string[][] = [];
  const isStr = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
  const visit = (node: ts.Node): void => {
    if (isStr(node) && node.text.length <= 300) {
      if (looksLikePath(node.text)) strings.push(node.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^glob(Eager)?$/.test(node.expression.name.text) &&
      ts.isMetaProperty(node.expression.expression)
    ) {
      const arg = node.arguments[0];
      const patterns = !arg ? [] : isStr(arg) ? [arg.text] : ts.isArrayLiteralExpression(arg) ? arg.elements.filter(isStr).map((e) => e.text) : [];
      if (patterns.length) globs.push(patterns);
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return { strings, globs };
}

/** Glob de Vite a expresión regular: `**`, `*`, `?` y `{a,b}`. */
/** Más comodines que esto en un patrón de `import.meta.glob` no se evalúa (ver abajo). */
export const MAX_GLOB_STARS = 3;
export const MAX_GLOB_LENGTH = 300;

/**
 * Patrón de `import.meta.glob` a expresión regular, o null si no se puede evaluar sin riesgo.
 * El patrón sale del código del repo analizado: `**\/**\/**\/…` daba una expresión con
 * retroceso exponencial que colgaba el análisis (ReDoS). Se juntan los `**` seguidos y se
 * rechazan los patrones con más de MAX_GLOB_STARS `**` o demasiado largos.
 */
export function globToRegExp(glob: string): RegExp | null {
  const g0 = glob.replace(/(?:\*\*\/)+/g, '**/').replace(/\*{3,}/g, '**');
  if (g0.length > MAX_GLOB_LENGTH || (g0.match(/\*\*/g)?.length ?? 0) > MAX_GLOB_STARS) return null;
  let depth = 0;
  const body = (g: string): string => {
    if (++depth > 20) throw new Error('glob demasiado anidado');
    let re = '';
    for (let i = 0; i < g.length; i++) {
      const c = g[i] as string;
      if (c === '*') {
        if (g[i + 1] === '*') {
          i++;
          if (g[i + 1] === '/') {
            i++;
            re += '(?:.*/)?';
          } else re += '.*';
        } else re += '[^/]*';
      } else if (c === '?') re += '[^/]';
      else if (c === '{' && g.indexOf('}', i) > i) {
        const end = g.indexOf('}', i);
        re += `(?:${g.slice(i + 1, end).split(',').map(body).join('|')})`;
        i = end;
      } else re += escapeRe(c);
    }
    return re;
  };
  try {
    return new RegExp(`^${body(g0)}$`);
  } catch {
    return null;
  }
}

/** Strings entre comillas con pinta de ruta (HTML, CSS, JSON, otros lenguajes). */
export function quotedStrings(text: string): string[] {
  const out: string[] = [];
  const re = /(['"`])((?:(?!\1)[^\\\n]|\\.){1,300}?)\1/g;
  for (const m of text.matchAll(re)) {
    const s = m[2];
    if (!s || (m[1] === '`' && s.includes('${'))) continue;
    if (looksLikePath(s)) out.push(s);
  }
  return out;
}

export function cssUrls(text: string): string[] {
  const out: string[] = [];
  // Repeticiones acotadas y sin saltos de línea: con `[^'")]+` un archivo con miles de `url(`
  // sin cerrar costaba tiempo cuadrático (ReDoS, ver docs/seguridad.md).
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'"()\n]{1,2048})\1\s*\)/g)) if (m[2]) out.push(m[2]);
  for (const m of text.matchAll(/@import\s+(['"])([^'"\n]{1,2048})\1/g)) if (m[2]) out.push(m[2]);
  return out;
}

export function htmlAttrs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:src|href|poster|data-src|xlink:href)\s*=\s*(['"])([^'"\n]{1,2048})\1/gi)) {
    if (m[2]) out.push(m[2]);
  }
  for (const m of text.matchAll(/\bsrcset\s*=\s*(['"])([^'"]{1,8192})\1/gi)) {
    for (const part of (m[2] ?? '').split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url) out.push(url);
    }
  }
  return out;
}

export function mdLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!?\[[^[\]\n]{0,1000}\]\(\s*<?([^()[\]\s>]{1,2048})>?(?:\s+"[^"\n]{0,500}")?\s*\)/g)) if (m[1]) out.push(m[1]);
  return out;
}

/** Rutas en los campos de entrada y en los scripts de package.json. */
function packageJsonRefs(text: string, resolve: Resolver, from: string): string[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(text);
  } catch {
    return [];
  }
  const out: string[] = [];
  const scripts = pkg.scripts as Record<string, string> | undefined;
  for (const cmd of Object.values(scripts ?? {})) {
    for (const token of String(cmd).split(/[\s=]+/)) {
      // Relativo al propio package.json: en un monorepo cada paquete tiene sus scripts.
      const to = resolve(token.replace(/^['"]|['"]$/g, ''), from);
      if (to) out.push(to);
    }
  }
  return out;
}

/** Puntos de entrada declarados en package.json: main, module, browser, types, bin, exports. */
export function packageEntryPoints(text: string): string[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(text);
  } catch {
    return [];
  }
  const out: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === 'string') out.push(posix.normalize(v.replace(/^\.\//, '')));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) collect(x);
  };
  for (const key of ['main', 'module', 'browser', 'types', 'typings', 'bin', 'exports']) collect(pkg[key]);
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
