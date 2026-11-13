import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BINARY_EXT, extOf } from './classify.js';
import { git } from './git.js';

/** Texto más grande que esto no se lee (ni líneas ni análisis de uso). */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

const WALK_SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.turbo', 'coverage']);

export const toPosix = (p: string): string => p.split(path.sep).join('/');

/**
 * Lista de archivos (SPEC §3.2): con git, seguidos + nuevos no ignorados, así `.gitignore`
 * se respeta exactamente. Sin git, recorrido del disco saltando las carpetas habituales.
 */
export async function listFiles(root: string, isGit: boolean): Promise<string[]> {
  if (isGit) {
    const out = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    return [...new Set(out.split('\0').filter(Boolean))];
  }
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) await walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        files.push(toPosix(path.relative(root, path.join(dir, e.name))));
      }
    }
  }
  await walk(root);
  return files;
}

/** Carpetas de primer nivel ignoradas por git (node_modules, dist…) con su peso total. */
export async function listIgnoredDirs(root: string): Promise<{ path: string; size: number }[]> {
  let out: string;
  try {
    out = await git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']);
  } catch {
    return [];
  }
  const tops = new Set<string>();
  for (const p of out.split('\0').filter(Boolean)) {
    const top = p.split('/')[0];
    if (top && top !== '.git') tops.add(top);
  }
  const result: { path: string; size: number }[] = [];
  for (const top of tops) {
    const abs = path.join(root, top);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) continue;
    result.push({ path: top, size: st.isDirectory() ? await dirSize(abs) : st.size });
  }
  return result;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(abs);
    else if (e.isFile()) total += (await fs.stat(abs).catch(() => null))?.size ?? 0;
  }
  return total;
}

export interface FileRead {
  size: number;
  binary: boolean;
  lines: number | null;
  /** Contenido si es texto y no supera MAX_TEXT_BYTES. */
  text: string | null;
}

/** Tamaño, binario o texto, nº de líneas y contenido. null si el archivo ya no existe. */
export async function readFile(root: string, rel: string): Promise<FileRead | null> {
  const abs = path.join(root, rel);
  const st = await fs.stat(abs).catch(() => null);
  if (!st || !st.isFile()) return null;
  if (BINARY_EXT.has(extOf(rel)) || st.size > MAX_TEXT_BYTES) {
    return { size: st.size, binary: BINARY_EXT.has(extOf(rel)), lines: null, text: null };
  }
  const buf = await fs.readFile(abs);
  const head = buf.subarray(0, 8000);
  if (head.includes(0)) return { size: st.size, binary: true, lines: null, text: null };
  return { size: st.size, binary: false, lines: countLines(buf), text: buf.toString('utf8') };
}

export function countLines(buf: Buffer): number {
  if (buf.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  return buf[buf.length - 1] === 10 ? n : n + 1;
}
