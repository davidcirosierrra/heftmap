import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { COMPONENT_EXT, extOf } from '../classify.js';
import type { FileEntry, Phase, Ref, RefKind, Warning } from '../types.js';
import { loadWorkspace, packageNameOf, probeFile, type Workspace } from '../workspace.js';
import { cssUrls, htmlAttrs, mdLinks, packageJsonRefs, quotedStrings, scanCode, tsImports } from './extract.js';
import { escapeRe, globToRegExp } from '../glob.js';
import { makeResolver, makeTsResolver } from './resolve.js';

/**
 * Grafo de uso (SPEC §4.3), en dos pasadas:
 *  1. Rutas: imports TS/JS resueltos con el tsconfig, strings con pinta de ruta,
 *     `url()` en CSS, `src`/`href` en HTML, enlaces en Markdown y scripts de package.json.
 *  2. Menciones: recursos sin referencia cuyo nombre aparece en algún archivo de texto.
 *
 * Nota: el `typescript` del proyecto analizado puede ser la 7 (nativa, sin API de
 * compilador). Heftmap usa su propia copia de TypeScript 5.x solo para leer imports.
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
   * Node, ni un módulo virtual: casi seguro un alias que Heftmap no sabe resolver (definido solo
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
