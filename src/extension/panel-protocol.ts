/**
 * Mensajes entre la extensión y el panel (webview). Solo tipos: este archivo lo importan
 * los dos bundles (Node y navegador) y no debe traer código de ninguno.
 */

import type { CommitInfo, RefKind, Usage, UsageRule } from '../core/types.js';
import type { Locale } from '../i18n/index.js';

/** Lo que el panel necesita de cada archivo. */
export interface PanelFile {
  /** Ruta relativa a la raíz, con `/`. */
  path: string;
  size: number;
  /** Estado de uso (SPEC §3.3). Solo vale con el índice completo. */
  usage?: Usage;
  /** Regla que decidió `usage` (para explicar el veredicto). Solo con el índice completo. */
  usageRule?: UsageRule;
  /** Posición de su último commit en `commits`; sin definir si no tiene (nuevo o fuera de `git.since`). */
  commit?: number;
  /** Cambios sin commit (árbol de trabajo o staging). */
  dirty?: boolean;
  /** Todavía no seguido por git: «nuevo». */
  untracked?: boolean;
  /** Nº de líneas; sin definir en binarios. Vale también con el índice a medias. */
  lines?: number;
  /** Nº de commits que lo tocan (dentro de `git.since`); sin definir = 0. */
  changes?: number;
  /** Lockfile o generado: fuera del cálculo de hotspots (SPEC §3.5). */
  generated?: boolean;
  /** Código fuente (TS/JS, componentes, CSS, HTML): lo único que cuenta en los hotspots. */
  code?: boolean;
}

/** Un commit que es el último cambio de algún archivo. */
export type PanelCommit = CommitInfo;

/** Referencia entre archivos, por posición en `files`: [origen, destino, tipo]. */
export type PanelRef = [from: number, to: number, kind: RefKind];

export interface PanelIndex {
  /** Nombre de la carpeta analizada. */
  rootName: string;
  /** false mientras solo se conocen los tamaños (primer análisis en curso). */
  complete: boolean;
  /** Todo el repo, sin recortar por ámbito: el panel filtra. */
  files: PanelFile[];
  /** Grafo de referencias de todo el repo (el ámbito no lo recorta, SPEC §3.1). */
  refs?: PanelRef[];
  /** false: la carpeta no es un repo de git (columnas y colores de git vacíos). */
  isGit?: boolean;
  /** Commits distintos referenciados por `files[].commit`. */
  commits?: PanelCommit[];
  /** Cuándo terminó el análisis que produjo este índice (ms desde epoch). */
  updatedAt?: number;
}

export interface PanelStatus {
  hasRoot: boolean;
  scope: string[];
  building: boolean;
  /** «uso 1.200/3.006», o null si no hay análisis en curso. */
  progress: string | null;
  /** Avance de la fase entre 0 y 1; null si la fase no se puede medir. */
  fraction: number | null;
  error: string | null;
  /** Idioma de la interfaz: el panel lo sigue si cambia el ajuste `heftmap.language`. */
  locale?: Locale;
}

export type HostMessage =
  /** null: todavía no hay índice (primer análisis) o no hay carpeta abierta. */
  | { type: 'index'; index: PanelIndex | null }
  | { type: 'status'; status: PanelStatus };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'open'; path: string }
  | { type: 'reveal'; path: string }
  /** «Ver diff» de un archivo con cambios sin commit. */
  | { type: 'diff'; path: string }
  /** Añade el archivo a `heftmap.usage.ignore`: deja de salir como «sin rastro». */
  | { type: 'ignoreUsage'; path: string }
  /** Pide mover a la papelera un archivo «sin rastro». La extensión confirma antes. */
  | { type: 'trash'; path: string }
  | { type: 'removeScope'; folder: string }
  | { type: 'clearScope' }
  | { type: 'pickScope' }
  | { type: 'refresh' }
  | { type: 'showLog' }
  | { type: 'copy'; text: string }
  /** Fallo dentro del panel: va al registro de Heftmap. */
  | { type: 'error'; where: string; message: string; stack?: string };
