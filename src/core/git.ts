import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CommitInfo, Warning } from './types.js';

const exec = promisify(execFile);

/**
 * Ejecutable de git, buscado a mano en el PATH (docs/seguridad.md):
 * - Solo carpetas absolutas, y nunca la carpeta analizada ni nada dentro de ella. En Windows,
 *   lanzar «git» con `cwd` en el repo busca primero `git.exe` en ese `cwd`: un repo con un
 *   `git.exe` en la raíz ejecutaría código al abrirlo.
 * - En Windows solo `git.exe`: los `.cmd`/`.bat` pasarían por un intérprete de órdenes.
 */
export function findGit(cwd: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const isWin = platform === 'win32';
  const p = isWin ? path.win32 : path.posix;
  const root = p.resolve(cwd);
  const inside = (dir: string): boolean => {
    const rel = p.relative(root, dir);
    return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
  };
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const raw of pathVar.split(isWin ? ';' : ':')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !p.isAbsolute(dir) || inside(p.resolve(dir))) continue;
    const candidate = p.join(dir, isWin ? 'git.exe' : 'git');
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // no está aquí
    }
  }
  return null;
}

/**
 * Configuración forzada en cada llamada, por si el repo analizado trae un `.git/config`
 * malicioso (descargado, no clonado): ni monitor del sistema de archivos (`core.fsmonitor`
 * ejecuta un programa en `git status`), ni verificación de firmas en `git log` (ejecuta
 * `gpg.program`), ni submódulos. Los filtros de `.gitattributes` no se pueden desactivar
 * así: por eso, en un workspace sin confianza, Heftmap no ejecuta git (SPEC §3.6).
 */
const SAFE_CONFIG = [
  '-c', 'core.quotePath=false',
  '-c', 'core.fsmonitor=false',
  '-c', 'log.showSignature=false',
  '-c', 'submodule.recurse=false',
  '-c', 'core.untrackedCache=false',
];

const gitByCwd = new Map<string, string | null>();

/** Ejecuta git en `cwd` y devuelve stdout. Rutas sin escapar (`core.quotePath=false`). */
export async function git(cwd: string, args: string[]): Promise<string> {
  let bin = gitByCwd.get(cwd);
  if (bin === undefined) gitByCwd.set(cwd, (bin = findGit(cwd)));
  if (!bin) throw Object.assign(new Error('git not found in PATH'), { code: 'ENOENT' });
  const { stdout } = await exec(bin, [...SAFE_CONFIG, ...args], {
    cwd,
    maxBuffer: 512 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
    // Sin preguntas por credenciales y sin bloquear el índice del usuario (`git status` lo
    // reescribiría para refrescar marcas de tiempo).
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  return stdout;
}

export interface GitInfo {
  isGit: boolean;
  prefix: string;
  head: string | null;
  /** Motivo por el que se trabaja sin git cuando no es simplemente «no es un repo». */
  warning?: Warning;
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
        warning: { code: 'no-git' },
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
): Promise<{ history: Map<string, FileHistory>; commits: number; warning?: Warning }> {
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
      warning: empty
        ? undefined
        : { code: 'git-history', detail: msg.split('\n').find((l) => l.trim() && !l.startsWith('Command failed')) ?? msg.split('\n')[0] ?? msg },
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
    out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all']);
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
