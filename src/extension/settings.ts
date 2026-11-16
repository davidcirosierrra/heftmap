import * as vscode from 'vscode';
import type { BuildOptions } from '../core/index.js';

/**
 * Ajustes de Heftmap (`heftmap.*`), leídos de una vez y validados. Es el único sitio que lee
 * la configuración: el resto de la extensión recibe un `HeftSettings`. Un valor del tipo
 * equivocado (p. ej. editado a mano en settings.json) cuenta como el valor por defecto.
 */

export const SECTION = 'heftmap';

export interface HeftSettings {
  /** `auto` (el idioma del editor) o un idioma; se resuelve con `resolveLocale`. */
  language: string;
  /** Carpeta contra la que se resuelven las rutas absolutas (`/models/x.glb`). */
  publicDir: string;
  /** Límite del historial de git (`1.year`); undefined = todo. */
  gitSince: string | undefined;
  /** Archivos que nunca cuentan como huérfanos. */
  usageIgnore: string[];
  /** Puntos de entrada extra. */
  usageEntryPoints: string[];
  /** Espera (ms) tras un cambio antes de volver a analizar. */
  refreshDelay: number;
  /** false: los cambios en disco y en git no relanzan el análisis; el botón de refrescar sí. */
  autoRefresh: boolean;
}

/** Límites de `heftmap.refreshDelay` (ms), los mismos que declara package.json. */
export const REFRESH_DELAY = { default: 1500, min: 250, max: 60000 } as const;

/** Lee todos los ajustes; `scope` es la carpeta del workspace (ajustes por carpeta). */
export function readSettings(scope?: vscode.Uri): HeftSettings {
  const cfg = vscode.workspace.getConfiguration(SECTION, scope);
  return {
    language: str(cfg.get('language')) || 'auto',
    publicDir: str(cfg.get('publicDir')) || 'public',
    gitSince: str(cfg.get('git.since')) || undefined,
    usageIgnore: strings(cfg.get('usage.ignore')),
    usageEntryPoints: strings(cfg.get('usage.entryPoints')),
    refreshDelay: num(cfg.get('refreshDelay'), REFRESH_DELAY),
    autoRefresh: bool(cfg.get('autoRefresh'), true),
  };
}

/** Opciones del análisis a partir de los ajustes. Sin confianza no se ejecuta git (SPEC §3.6). */
export function toBuildOptions(s: HeftSettings, trusted: boolean): BuildOptions {
  return {
    publicDir: s.publicDir,
    since: s.gitSince,
    ignore: s.usageIgnore,
    entryPoints: s.usageEntryPoints,
    useGit: trusted,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Número dentro de [min, max], redondeado; fuera del rango se recorta, si no es número vale `default`. */
function num(v: unknown, r: { default: number; min: number; max: number }): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return r.default;
  return Math.min(r.max, Math.max(r.min, Math.round(v)));
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Añade un archivo a `heftmap.usage.ignore` del workspace (lo que pide «Ignorar este archivo»).
 * false si ya estaba. Si falla al guardar, lanza.
 */
export async function addUsageIgnore(root: vscode.Uri, file: string): Promise<boolean> {
  const list = readSettings(root).usageIgnore;
  if (list.includes(file)) return false;
  await vscode.workspace.getConfiguration(SECTION, root).update('usage.ignore', [...list, file].sort(), vscode.ConfigurationTarget.Workspace);
  return true;
}
