import path from 'node:path';
import ts from 'typescript';
import { extOf } from '../classify.js';
import type { Resolver } from './resolve.js';

/** Extractores (SPEC §4.3): rutas escritas en cada lenguaje (TS/JS, CSS, HTML, Markdown, package.json). */

const posix = path.posix;

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
export function packageJsonRefs(text: string, resolve: Resolver, from: string): string[] {
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
