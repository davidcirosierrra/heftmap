/**
 * Mensajes entre la extensión y el panel (webview). Solo tipos: este archivo lo importan
 * los dos bundles (Node y navegador) y no debe traer código de ninguno.
 */

/** Lo que el panel necesita de cada archivo. Crece con las fases (uso, git, líneas). */
export interface PanelFile {
  /** Ruta relativa a la raíz, con `/`. */
  path: string;
  size: number;
}

export interface PanelIndex {
  /** Nombre de la carpeta analizada. */
  rootName: string;
  /** false mientras solo se conocen los tamaños (primer análisis en curso). */
  complete: boolean;
  /** Todo el repo, sin recortar por ámbito: el panel filtra. */
  files: PanelFile[];
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
}

export type HostMessage =
  /** null: todavía no hay índice (primer análisis) o no hay carpeta abierta. */
  | { type: 'index'; index: PanelIndex | null }
  | { type: 'status'; status: PanelStatus };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'open'; path: string }
  | { type: 'removeScope'; folder: string }
  | { type: 'clearScope' }
  | { type: 'pickScope' }
  | { type: 'refresh' }
  | { type: 'showLog' }
  | { type: 'copy'; text: string }
  /** Fallo dentro del panel: va al registro de Heft. */
  | { type: 'error'; where: string; message: string; stack?: string };
