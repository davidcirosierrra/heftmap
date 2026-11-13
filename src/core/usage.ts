import path from 'node:path';
import ts from 'typescript';
import { COMPONENT_EXT, extOf } from './classify.js';
import { toPosix } from './files.js';
import type { FileEntry, Ref, RefKind } from './types.js';

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

export interface UsageInput {
  root: string;
  files: Map<string, FileEntry>;
  texts: Map<string, string>;
  /** Archivos que se leen como origen de referencias. */
  sources: string[];
  publicDir: string;
}

export interface UsageResult {
  refs: Ref[];
  warnings: string[];
}

export function analyzeUsage(input: UsageInput): UsageResult {
  const { root, files, texts, sources, publicDir } = input;
  const refs: Ref[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  const unresolved: string[] = [];

  const add = (from: string, to: string | null, kind: RefKind): void => {
    if (!to || to === from || !files.has(to)) return;
    const key = `${from}\0${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ from, to, kind });
  };

  const resolve = makeResolver(files, publicDir);
  const tsc = makeTsResolver(root);

  for (const from of sources) {
    const text = texts.get(from);
    if (text == null) continue;
    const ext = extOf(from);
    const base = posix.basename(from);

    if (base === 'package.json') {
      for (const to of packageJsonRefs(text, resolve)) add(from, to, 'script npm');
      continue;
    }
    if (COMPONENT_EXT.has(ext)) {
      // .vue/.svelte/.astro: imports del bloque <script>, atributos de la plantilla y strings.
      for (const spec of ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName)) {
        const viaTs = tsc(spec, from);
        const to = viaTs === undefined ? resolve(spec, from) : viaTs;
        if (to) add(from, to, 'import');
      }
      for (const spec of htmlAttrs(text)) add(from, resolve(spec, from), 'src/href');
      for (const spec of quotedStrings(text)) add(from, resolve(spec, from), 'ruta en string');
      continue;
    }
    if (CODE_EXT.has(ext)) {
      for (const spec of tsImports(text, ext)) {
        const viaTs = tsc(spec, from);
        const to = viaTs === undefined ? resolve(spec, from) : viaTs;
        if (to) add(from, to, 'import');
        else if (viaTs === undefined && (spec.startsWith('./') || spec.startsWith('../'))) {
          unresolved.push(`${from} → ${spec}`);
        }
      }
      // Strings del AST: sin comentarios (un JSDoc que cita una ruta no es uso).
      for (const spec of codeStrings(text, from)) add(from, resolve(spec, from), 'ruta en string');
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
  for (const f of files.values()) {
    if (f.category !== 'resource' || f.ignoredByGit || referenced.has(f.path)) continue;
    const base = posix.basename(f.path);
    const stem = base.replace(/\.[^.]+$/, '');
    const needles = [base];
    // Raíces de 1-2 letras («a.png», «bg.png») darían menciones falsas por todas partes.
    // Con 3 ya se cuelan palabras comunes, pero un «mencionado» de más es mejor que un
    // «sin rastro» falso, que es el que invita a borrar (p. ej. 'wiz' en una lista de logos).
    if (stem.length >= 3 && stem !== base) needles.push(stem);
    const re = new RegExp(`(?<![\\w-])(?:${needles.map(escapeRe).join('|')})(?![\\w-])`);
    for (const src of haystack) {
      if (src === f.path) continue;
      if (re.test(texts.get(src) ?? '')) add(src, f.path, 'mención');
    }
  }

  if (unresolved.length) {
    warnings.push(`${unresolved.length} imports relativos sin resolver (p. ej. ${unresolved.slice(0, 3).join(', ')})`);
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
      candidates.push(...publicDirsFor(dir).map((p) => posix.join(p, spec)), spec.slice(1));
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
function makeTsResolver(root: string): (spec: string, from: string) => string | null | undefined {
  const configs = loadTsConfigs(root);
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
  const optionsFor = (absFile: string): ts.CompilerOptions => {
    for (const c of configs) if (c.files.has(absFile)) return c.options;
    return configs[0]?.options ?? fallback;
  };
  return (spec, from) => {
    const absFrom = path.join(root, from);
    const options = optionsFor(absFrom);
    let cache = caches.get(options);
    if (!cache) {
      cache = ts.createModuleResolutionCache(root, (x) => x, options);
      caches.set(options, cache);
    }
    const { resolvedModule } = ts.resolveModuleName(spec, absFrom, options, ts.sys, cache);
    if (!resolvedModule) return undefined;
    if (resolvedModule.isExternalLibraryImport) return null;
    const rel = toPosix(path.relative(root, resolvedModule.resolvedFileName));
    return rel.startsWith('..') ? null : rel;
  };
}

interface TsConfig {
  options: ts.CompilerOptions;
  files: Set<string>;
}

/** tsconfig.json de la raíz y sus `references` (patrón habitual de Vite: app + node). */
function loadTsConfigs(root: string): TsConfig[] {
  const result: TsConfig[] = [];
  const visited = new Set<string>();
  const load = (configPath: string): void => {
    if (visited.has(configPath) || !ts.sys.fileExists(configPath)) return;
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
    if (parsed.fileNames.length) result.push({ options, files: new Set(parsed.fileNames.map((f) => path.resolve(f))) });
    for (const ref of parsed.projectReferences ?? []) {
      const p = ref.path.endsWith('.json') ? ref.path : path.join(ref.path, 'tsconfig.json');
      load(path.resolve(path.dirname(configPath), p));
    }
  };
  load(path.join(root, 'tsconfig.json'));
  load(path.join(root, 'jsconfig.json'));
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
  const ext = extOf(fileName);
  const kind = ext === 'tsx' ? ts.ScriptKind.TSX : ext === 'jsx' ? ts.ScriptKind.JSX : ext.includes('ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.length <= 300) {
      if (looksLikePath(node.text)) out.push(node.text);
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
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
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) if (m[2]) out.push(m[2]);
  for (const m of text.matchAll(/@import\s+(['"])([^'"]+)\1/g)) if (m[2]) out.push(m[2]);
  return out;
}

export function htmlAttrs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:src|href|poster|data-src|xlink:href)\s*=\s*(['"])([^'"]+)\1/gi)) {
    if (m[2]) out.push(m[2]);
  }
  for (const m of text.matchAll(/\bsrcset\s*=\s*(['"])([^'"]+)\1/gi)) {
    for (const part of (m[2] ?? '').split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url) out.push(url);
    }
  }
  return out;
}

export function mdLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) if (m[1]) out.push(m[1]);
  return out;
}

/** Rutas en los campos de entrada y en los scripts de package.json. */
function packageJsonRefs(text: string, resolve: Resolver): string[] {
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
      const to = resolve(token.replace(/^['"]|['"]$/g, ''), 'package.json');
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
