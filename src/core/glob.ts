import { MAX_GLOB_LENGTH, MAX_GLOB_STARS } from './limits.js';

/** Globs: los de `import.meta.glob` de Vite (SPEC §4.3) y los de `heftmap.exclude`. */

/**
 * Glob de Vite (`**`, `*`, `?` y `{a,b}`) a expresión regular, o null si no se puede evaluar sin riesgo.
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

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Patrones de exclusión al estilo de .gitignore, sobre rutas relativas con `/`:
 *  - sin `/` (p. ej. `*.snap`, `fixtures`) casan con ese nombre en cualquier carpeta;
 *  - con `/` (p. ej. `docs/images`, `src/**\/*.gen.ts`) son relativos a la raíz;
 *  - un patrón casa con un archivo si casa con él o con cualquiera de sus carpetas, así que
 *    `dist` o `docs/images/` excluyen la carpeta entera.
 * Los patrones que no se pueden evaluar sin riesgo (ver `globToRegExp`) se devuelven en `invalid`.
 */
export function pathMatcher(patterns: readonly string[]): { matches(path: string): boolean; invalid: string[] } {
  const res: RegExp[] = [];
  const invalid: string[] = [];
  for (const raw of patterns) {
    const p = raw.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '');
    if (!p) continue;
    const re = globToRegExp(p.includes('/') ? p : `**/${p}`);
    if (re) res.push(re);
    else invalid.push(raw);
  }
  const matches = (path: string): boolean => {
    if (res.length === 0) return false;
    // El archivo y cada una de sus carpetas: a/b/c.ts → a/b/c.ts, a/b, a.
    for (let p = path; p; p = p.slice(0, Math.max(0, p.lastIndexOf('/')))) {
      if (res.some((re) => re.test(p))) return true;
    }
    return false;
  };
  return { matches, invalid };
}
