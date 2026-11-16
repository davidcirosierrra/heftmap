import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { CommitInfo } from './types.js';

const exec = promisify(execFile);

/** Ejecuta git en `cwd` y devuelve stdout. Rutas sin escapar (`core.quotePath=false`). */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    maxBuffer: 512 * 1024 * 1024,
    encoding: 'utf8',
  });
  return stdout;
}

export interface GitInfo {
  isGit: boolean;
  prefix: string;
  head: string | null;
  /** Motivo por el que se trabaja sin git cuando no es simplemente «no es un repo». */
  warning?: string;
}

export async function gitInfo(root: string): Promise<GitInfo> {
  try {
    const inside = (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside !== 'true') return { isGit: false, prefix: '', head: null };
    const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim();
    let head: string | null = null;
    try {
      head = (await git(root, ['rev-parse', 'HEAD'])).trim();
    } catch {
      // repo sin commits
    }
    return { isGit: true, prefix, head };
  } catch (err) {
    // Sin el ejecutable no se puede saber si es un repo: se avisa en vez de callar.
    // (ENOENT también sale si la carpeta no existe; ese caso falla después, al listar.)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' && existsSync(root)) {
      return {
        isGit: false,
        prefix: '',
        head: null,
        warning: 'No se encuentra «git» en el PATH: se analiza sin git (sin .gitignore, historial ni cambios)',
      };
    }
    return { isGit: false, prefix: '', head: null };
  }
}

export interface FileHistory {
  last: CommitInfo;
  changes: number;
}

/**
 * Un único `git log` para todo el repo (SPEC §4.3): la primera aparición de cada ruta
 * es su último commit y el nº de apariciones su recuento de cambios. Sin seguir
 * renombrados (`--no-renames`), decisión consciente (SPEC §3.5).
 */
export async function readHistory(
  root: string,
  since?: string,
): Promise<{ history: Map<string, FileHistory>; commits: number; warning?: string }> {
  const args = [
    'log',
    '--no-renames',
    '--name-only',
    '--relative',
    '--format=%x00%H%x09%h%x09%an%x09%at%x09%s',
  ];
  if (since) args.push(`--since=${since}`);
  let out: string;
  try {
    out = await git(root, args);
  } catch (err) {
    // Repo sin commits: no es un error. Cualquier otro fallo se cuenta.
    const msg = err instanceof Error ? err.message : String(err);
    const empty = /does not have any commits yet|bad default revision/.test(msg);
    return {
      history: new Map(),
      commits: 0,
      warning: empty ? undefined : `No se pudo leer el historial de git: ${msg.split('\n').find((l) => l.trim() && !l.startsWith('Command failed')) ?? msg.split('\n')[0]}`,
    };
  }
  const history = new Map<string, FileHistory>();
  let commits = 0;
  for (const chunk of out.split('\0')) {
    if (!chunk.trim()) continue;
    const lines = chunk.split('\n');
    const header = lines[0] ?? '';
    const [hash = '', short = '', author = '', at = '0', ...subjectParts] = header.split('\t');
    if (!hash) continue;
    commits++;
    const info: CommitInfo = { hash, short, author, time: Number(at) * 1000, subject: subjectParts.join('\t') };
    for (let i = 1; i < lines.length; i++) {
      const file = lines[i];
      if (!file) continue;
      const prev = history.get(file);
      if (prev) prev.changes++;
      else history.set(file, { last: info, changes: 1 });
    }
  }
  return { history, commits };
}

/**
 * Cambios sin commit y archivos nuevos. En la extensión vendrá de la API `vscode.git`;
 * aquí, de `git status`. Las rutas de porcelain son relativas a la raíz del repo.
 */
export async function readStatus(root: string, prefix: string): Promise<{ dirty: Set<string>; untracked: Set<string> }> {
  const dirty = new Set<string>();
  const untracked = new Set<string>();
  let out: string;
  try {
    out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  } catch {
    return { dirty, untracked };
  }
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    let file = entry.slice(3);
    // En renombrados/copias, la ruta de origen viene en el siguiente campo.
    if (xy[0] === 'R' || xy[0] === 'C') i++;
    if (prefix) {
      if (!file.startsWith(prefix)) continue;
      file = file.slice(prefix.length);
    }
    if (xy === '??') untracked.add(file);
    else dirty.add(file);
  }
  return { dirty, untracked };
}
