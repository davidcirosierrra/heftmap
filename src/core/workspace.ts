import path from 'node:path';

/**
 * Paquetes del propio repo (monorepos, SPEC §4.3). Se descubren leyendo todos los
 * `package.json` del índice: no depende de npm, pnpm, yarn, Nx ni Turborepo, ni de que
 * `node_modules` esté instalado. Sirve para dos cosas:
 *  - resolver `import x from '@scope/pkg'` al archivo fuente de ese paquete, y
 *  - saber qué archivos son la entrada de cada paquete (nunca cuentan como huérfanos).
 */
const posix = path.posix;

export interface WorkspacePackage {
  name: string;
  /** Carpeta del paquete relativa a la raíz; '' para el de la raíz. */
  dir: string;
  pkg: Record<string, unknown>;
}

export interface Workspace {
  packages: Map<string, WorkspacePackage>;
  /** Nombres declarados como dependencia en algún `package.json` del repo. */
  declared: Set<string>;
  /**
   * Archivo del índice al que apunta un import de paquete. `undefined`: no es un paquete
   * del repo. `null`: lo es, pero no se encuentra el archivo.
   */
  resolve(spec: string): string | null | undefined;
  /** Entradas declaradas por los paquetes (main, exports, bin…), ya como archivos del índice. */
  entryPoints(): string[];
}

/** Extensiones que se prueban cuando el import no la lleva o lleva la del archivo compilado. */
const EXTS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'vue', 'svelte', 'astro'];
/** Carpetas de salida habituales: `dist/index.js` suele salir de `src/index.ts`. */
const BUILD_DIR = /^(?:dist|build|lib|out|esm|cjs|es|types)\/(.+)$/;
/** Condiciones de `exports`, de la más cercana al código fuente a la más lejana. */
const CONDITIONS = ['source', 'development', 'types', 'import', 'module', 'default', 'require'];
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`. */
export function packageNameOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

/** Destinos de un subpath en el campo `exports`, ordenados por preferencia. */
export function exportTargets(exportsField: unknown, subpath: string): string[] {
  const leaves = (v: unknown, depth = 0): string[] => {
    if (typeof v === 'string') return [v];
    if (!v || typeof v !== 'object' || depth > 6) return [];
    if (Array.isArray(v)) return v.flatMap((x) => leaves(x, depth + 1));
    const obj = v as Record<string, unknown>;
    const keys = [...CONDITIONS.filter((c) => c in obj), ...Object.keys(obj).filter((k) => !CONDITIONS.includes(k))];
    return keys.flatMap((k) => leaves(obj[k], depth + 1));
  };
  if (exportsField == null) return [];
  const isMap = typeof exportsField === 'object' && !Array.isArray(exportsField) && Object.keys(exportsField).some((k) => k.startsWith('.'));
  if (!isMap) return subpath === '.' ? leaves(exportsField) : [];
  const map = exportsField as Record<string, unknown>;
  if (subpath in map) return leaves(map[subpath]);
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf('*');
    if (star < 0) continue;
    const pre = key.slice(0, star);
    const post = key.slice(star + 1);
    if (subpath.length >= pre.length + post.length && subpath.startsWith(pre) && subpath.endsWith(post)) {
      const captured = subpath.slice(pre.length, subpath.length - post.length);
      return leaves(value).map((t) => t.replaceAll('*', captured));
    }
  }
  return [];
}

/**
 * Archivo del índice para una ruta escrita sin extensión, con la del compilado (`x.js`,
 * `x.d.ts`) o con una que no es la suya: `./src/*.ts` con `*` = `i18n` da `src/i18n.ts`, que
 * en realidad es la carpeta `src/i18n/index.ts`.
 */
export function probeFile(has: (p: string) => boolean, raw: string): string | null {
  const rel = posix.normalize(raw);
  if (!rel || rel === '.' || rel.startsWith('../')) return null;
  if (has(rel)) return rel;
  const stem = rel.replace(/\.d\.[cm]?ts$|\.[cm]?[jt]sx?$/, '');
  for (const base of new Set([stem, rel])) {
    for (const e of EXTS) if (has(`${base}.${e}`)) return `${base}.${e}`;
  }
  for (const base of new Set([stem, rel])) {
    for (const e of EXTS) if (has(`${base}/index.${e}`)) return `${base}/index.${e}`;
  }
  return null;
}

export function loadWorkspace(files: Map<string, { ignoredByGit?: boolean }>, texts: Map<string, string>): Workspace {
  const has = (p: string): boolean => {
    const f = files.get(p);
    return !!f && !f.ignoredByGit;
  };

  const packages = new Map<string, WorkspacePackage>();
  const declared = new Set<string>();
  const all: WorkspacePackage[] = [];
  for (const file of files.keys()) {
    if (posix.basename(file) !== 'package.json' || !has(file) || /(^|\/)node_modules\//.test(file)) continue;
    let pkg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(texts.get(file) ?? '');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      pkg = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const field of DEP_FIELDS) {
      const deps = pkg[field];
      if (deps && typeof deps === 'object') for (const name of Object.keys(deps)) declared.add(name);
    }
    const dir = posix.dirname(file) === '.' ? '' : posix.dirname(file);
    const entry: WorkspacePackage = { name: typeof pkg.name === 'string' ? pkg.name : '', dir, pkg };
    all.push(entry);
    // Nombre repetido (plantillas, ejemplos): gana el paquete menos anidado.
    const prev = entry.name ? packages.get(entry.name) : undefined;
    if (entry.name && (!prev || dir.split('/').length < prev.dir.split('/').length)) packages.set(entry.name, entry);
  }

  const probe = (raw: string): string | null => probeFile(has, raw);

  /** Un destino declarado y sus equivalentes en el código fuente (`dist/x.js` → `src/x`, `x`). */
  const variants = (target: string): string[] => {
    const clean = target.replace(/^\.\//, '');
    const out = [clean];
    let rest = clean;
    for (let m = BUILD_DIR.exec(rest); m; m = BUILD_DIR.exec(rest)) {
      rest = m[1] as string;
      out.push(`src/${rest}`, rest);
    }
    return out;
  };

  const inPackage = (p: WorkspacePackage, targets: string[]): string | null => {
    for (const t of targets) {
      if (typeof t !== 'string' || !t) continue;
      for (const v of variants(t)) {
        const hit = probe(posix.join(p.dir, v));
        if (hit) return hit;
      }
    }
    return null;
  };

  const strings = (p: WorkspacePackage, fields: string[]): string[] => fields.map((f) => p.pkg[f]).filter((v): v is string => typeof v === 'string');

  const resolveIn = (p: WorkspacePackage, subpath: string): string | null => {
    const targets = exportTargets(p.pkg.exports, subpath);
    if (subpath === '.') targets.push(...strings(p, ['source', 'types', 'typings', 'module', 'main']), 'src/index', 'index');
    else {
      const rest = subpath.slice(2);
      targets.push(rest, `src/${rest}`);
    }
    return inPackage(p, targets);
  };

  const cache = new Map<string, string | null | undefined>();
  const resolve = (spec: string): string | null | undefined => {
    const clean = spec.replace(/(?!^)[?#].*$/, '');
    if (cache.has(clean)) return cache.get(clean);
    const name = packageNameOf(clean);
    const p = packages.get(name);
    const result = p ? resolveIn(p, clean.length > name.length ? `.${clean.slice(name.length)}` : '.') : undefined;
    cache.set(clean, result);
    return result;
  };

  const entryPoints = (): string[] => {
    const out = new Set<string>();
    for (const p of all) {
      const raw: string[] = strings(p, ['main', 'module', 'browser', 'types', 'typings', 'source']);
      const bin = p.pkg.bin;
      if (typeof bin === 'string') raw.push(bin);
      else if (bin && typeof bin === 'object') raw.push(...Object.values(bin).filter((v): v is string => typeof v === 'string'));
      const exp = p.pkg.exports;
      const keys = exp && typeof exp === 'object' && !Array.isArray(exp) ? Object.keys(exp).filter((k) => k.startsWith('.')) : [];
      // Los patrones (`./*`) exponen media carpeta: no se cuentan como entrada, solo los subpaths concretos.
      for (const key of ['.', ...keys.filter((k) => !k.includes('*'))]) raw.push(...exportTargets(exp, key));
      for (const t of raw) {
        // Tal cual (compatibilidad: puede ser un archivo sin análisis) y su equivalente en el fuente.
        out.add(posix.normalize(posix.join(p.dir, t.replace(/^\.\//, ''))));
        const hit = inPackage(p, [t]);
        if (hit) out.add(hit);
      }
    }
    return [...out];
  };

  return { packages, declared, resolve, entryPoints };
}
