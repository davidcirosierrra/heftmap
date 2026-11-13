import path from 'node:path';
import type { Category } from './types.js';

const CODE = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']);
/** Componentes de un solo archivo: plantilla HTML + script. */
export const COMPONENT_EXT = new Set(['vue', 'svelte', 'astro']);
const STYLE = new Set(['css', 'scss', 'sass', 'less', 'styl']);
const MARKUP = new Set(['html', 'htm']);
const DOC = new Set(['md', 'mdx', 'txt', 'rst', 'adoc']);
const SCRIPT = new Set(['py', 'sh', 'bash', 'ps1', 'rb', 'pl', 'lua', 'go', 'rs']);
const RESOURCE = new Set([
  // imágenes
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff',
  // 3D y texturas
  'glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'usdz', 'hdr', 'exr', 'ktx', 'ktx2', 'basis', 'dds', 'bin',
  // audio y vídeo
  'mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'flac', 'opus', 'mp4', 'webm', 'mov', 'm4v',
  // fuentes
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // datos
  'csv', 'tsv', 'geojson', 'wasm', 'pdf', 'zip',
]);

/** Extensiones que nunca se leen como texto. */
export const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tif', 'tiff',
  'glb', 'fbx', 'stl', 'ply', 'usdz', 'hdr', 'exr', 'ktx', 'ktx2', 'basis', 'dds', 'bin',
  'mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'flac', 'opus', 'mp4', 'webm', 'mov', 'm4v',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'wasm', 'pdf', 'zip', 'gz', 'tgz', '7z', 'jar', 'exe', 'dll', 'so', 'dylib',
]);

const LOCKFILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock',
  'npm-shrinkwrap.json', 'cargo.lock', 'poetry.lock', 'composer.lock', 'gemfile.lock',
]);

const CONFIG_NAMES = new Set([
  'package.json', '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
  '.prettierrc', '.prettierignore', '.eslintignore', '.dockerignore', 'dockerfile',
  'license', 'licence', 'makefile', 'vercel.json', 'netlify.toml', 'wrangler.toml',
]);

export function extOf(p: string): string {
  const base = path.posix.basename(p);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase();
}

export function categorize(p: string): Category {
  const base = path.posix.basename(p).toLowerCase();
  const ext = extOf(p);
  if (LOCKFILES.has(base)) return 'lockfile';
  if (CONFIG_NAMES.has(base)) return 'config';
  if (/^tsconfig(\..+)?\.json$/.test(base) || /^jsconfig(\..+)?\.json$/.test(base)) return 'config';
  // .eslintrc, .oxlintrc.json, .babelrc…
  if (base.startsWith('.') && !CODE.has(ext)) return 'config';
  // .github/workflows, .vscode, .husky…: configuración de herramientas, salvo código
  if (/^\.[^/]+\//.test(p) && !CODE.has(ext) && !COMPONENT_EXT.has(ext) && !RESOURCE_MEDIA.has(ext)) return 'config';
  if (ext === 'yaml' || ext === 'yml' || ext === 'toml' || ext === 'ini') return 'config';
  if (CODE.has(ext) || COMPONENT_EXT.has(ext)) return 'code';
  if (STYLE.has(ext)) return 'style';
  if (MARKUP.has(ext)) return 'markup';
  if (DOC.has(ext)) return 'doc';
  if (SCRIPT.has(ext)) return 'script';
  if (RESOURCE.has(ext)) return 'resource';
  if (ext === 'json' || ext === 'webmanifest' || ext === 'xml') return 'resource';
  return 'other';
}

/** Medios que siguen siendo recursos aunque vivan en una carpeta con punto (.vitepress/…). */
const RESOURCE_MEDIA = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'mp3', 'mp4', 'webm']);

/** Generados y lockfiles: cambian mucho y no dicen nada en los hotspots. */
export function isGenerated(p: string): boolean {
  const base = path.posix.basename(p).toLowerCase();
  if (LOCKFILES.has(base)) return true;
  return /\.(gen|generated|min)\.[a-z0-9]+$/.test(base) || /(^|\/)(__generated__|generated)\//.test(p);
}

/**
 * Puntos de entrada por convención (SPEC §3.3). Los campos de package.json y los
 * añadidos por el usuario se suman aparte.
 */
export function isConventionalEntry(p: string, publicDir: string): boolean {
  const base = path.posix.basename(p).toLowerCase();
  if (p === 'index.html') return true;
  if (/\.config\.[cm]?[jt]s$/.test(base)) return true; // vite.config.ts, eslint.config.js…
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || /(^|\/)__tests__\//.test(p)) return true;
  if (/\.stories\.[cm]?[jt]sx?$/.test(base)) return true;
  if (/\.d\.[cm]?ts$/.test(base)) return true;
  if (/^(sw|service-worker)\.[cm]?[jt]s$/.test(base)) return true;
  if (base.endsWith('.webmanifest') || base === 'manifest.json') return true;
  // Scripts que se ejecutan a mano (node scripts/x.mjs)
  if (/^(scripts|tools|bin)\//.test(p)) return true;
  // Servidos por convención desde una carpeta pública (public/, docs/public/…)
  const pi = p.indexOf(publicDir + '/');
  if (pi === 0 || (pi > 0 && p[pi - 1] === '/')) {
    const inPublic = p.slice(pi + publicDir.length + 1);
    if (/^(favicon\.[a-z]+|robots\.txt|sitemap\.xml|_redirects|_headers|cname|humans\.txt|\.nojekyll)$/i.test(inPublic)) {
      return true;
    }
    if (inPublic.startsWith('.well-known/')) return true;
  }
  return false;
}

/** Categorías cuyo uso no se juzga (SPEC §3.3: configuración, documentación, lockfiles). */
export function isNotAnalyzedCategory(c: Category): boolean {
  return c === 'config' || c === 'lockfile' || c === 'doc' || c === 'script' || c === 'other';
}

/** Categorías que se leen como origen de referencias. */
export function isSourceCategory(c: Category, p: string): boolean {
  if (c === 'lockfile') return false;
  const base = path.posix.basename(p).toLowerCase();
  if (c === 'config') return base === 'package.json';
  if (c === 'resource') {
    const ext = extOf(p);
    return ext === 'json' || ext === 'webmanifest' || ext === 'svg' || ext === 'xml';
  }
  return c !== 'other';
}
