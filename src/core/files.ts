import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { BINARY_EXT, extOf } from './classify.js';
import { git } from './git.js';
import { MAX_TEXT_BYTES } from './limits.js';

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
  /** Contenido si es texto y no supera el límite (`maxTextBytes`). */
  text: string | null;
}

/**
 * Tamaño, binario o texto, nº de líneas y contenido. null si el archivo ya no existe. Un texto de
 * más de `maxTextBytes` no se lee: se sabe su tamaño, pero no sus líneas ni su contenido.
 */
export async function readFile(root: string, rel: string, maxTextBytes: number = MAX_TEXT_BYTES): Promise<FileRead | null> {
  const abs = path.join(root, rel);
  // Un enlace simbólico no se sigue: puede apuntar fuera del repo (~/.ssh, /dev/zero). Cuenta
  // como el enlace en sí, igual que lo guarda git.
  const lst = await fs.lstat(abs).catch(() => null);
  if (!lst) return null;
  if (lst.isSymbolicLink()) return { size: lst.size, binary: false, lines: null, text: null };
  if (!lst.isFile()) return null;
  // Se abre una vez y todo lo demás va sobre el descriptor: entre el `lstat` y la lectura alguien
  // podría cambiar el archivo por un enlace. O_NOFOLLOW no existe en Windows.
  const fh = await fs.open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => null);
  if (!fh) return null;
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.dev !== lst.dev || st.ino !== lst.ino) return null;
    if (BINARY_EXT.has(extOf(rel)) || st.size > maxTextBytes) {
      return { size: st.size, binary: BINARY_EXT.has(extOf(rel)), lines: null, text: null };
    }
    const buf = await fh.readFile();
    const head = buf.subarray(0, 8000);
    if (head.includes(0)) return { size: st.size, binary: true, lines: null, text: null };
    return { size: st.size, binary: false, lines: countLines(buf), text: buf.toString('utf8') };
  } finally {
    await fh.close();
  }
}

export function countLines(buf: Buffer): number {
  if (buf.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  return buf[buf.length - 1] === 10 ? n : n + 1;
}
