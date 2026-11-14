/** Tipo de archivo, decide si se analiza como origen o destino de referencias. */
export type Category =
  | 'code' // TS/JS
  | 'style' // CSS y derivados
  | 'markup' // HTML
  | 'doc' // Markdown, texto
  | 'config' // package.json, tsconfig, dotfiles de herramientas
  | 'lockfile'
  | 'resource' // imágenes, modelos, audio, vídeo, fuentes, datos
  | 'script' // código en otros lenguajes (Python, shell…)
  | 'other';

/** Estado de uso (SPEC §3.3). */
export type Usage =
  | 'referenced' // alguna ruta se resuelve hacia él
  | 'mentioned' // solo aparece su nombre
  | 'none' // recurso sin rastro: candidato a borrar
  | 'no-importers' // código sin importadores: aviso de baja confianza
  | 'entry' // punto de entrada
  | 'not-analyzed' // configuración, documentación, lockfiles, otros lenguajes
  | 'exception' // el usuario lo marcó como «nunca huérfano»
  | 'ignored-by-git'; // solo con includeIgnored

export type RefKind =
  | 'import'
  | 'ruta en string'
  | 'url()'
  | 'src/href'
  | 'enlace md'
  | 'import.meta.glob'
  | 'script npm'
  | 'mención';

export interface Ref {
  from: string;
  to: string;
  kind: RefKind;
}

export interface CommitInfo {
  hash: string;
  short: string;
  author: string;
  /** Milisegundos desde epoch. */
  time: number;
  subject: string;
}

export interface FileEntry {
  /** Ruta relativa a la raíz, con `/`. */
  path: string;
  size: number;
  ext: string;
  category: Category;
  binary: boolean;
  /** Nº de líneas en archivos de texto; null en binarios o no leídos. */
  lines: number | null;
  /** Generado o lockfile: fuera de los hotspots. */
  generated: boolean;
  /** Pseudo-entrada para una carpeta ignorada por git (node_modules, dist…). */
  ignoredByGit: boolean;
  /** Archivo no seguido por git todavía. */
  untracked: boolean;
  /** Cambios sin commit (árbol de trabajo o staging). */
  dirty: boolean;
  lastCommit: CommitInfo | null;
  /** Nº de commits que lo tocan (dentro de `since`). */
  changes: number;
  usage: Usage;
  refsIn: Ref[];
  refsOut: Ref[];
}

export interface BuildOptions {
  /** Incluye carpetas ignoradas por git como pseudo-entradas con su peso. */
  includeIgnored?: boolean;
  /** Límite del historial, p. ej. `1.year` (se pasa a `git log --since`). */
  since?: string;
  /** Carpeta contra la que se resuelven rutas absolutas `/x.png`. */
  publicDir?: string;
  /** Puntos de entrada extra (rutas relativas). */
  entryPoints?: string[];
  /** Archivos que nunca cuentan como huérfanos. */
  ignore?: string[];
}

/** Fase del análisis, en orden. `mentions` es la segunda pasada del uso. */
export type Phase = 'list' | 'read' | 'git' | 'usage' | 'mentions';

/** Avance dentro de una fase. `total` es 0 cuando la fase no se puede medir (listado, git). */
export interface Progress {
  phase: Phase;
  done: number;
  total: number;
}

/** Avisos durante el análisis, para pintar progreso sin esperar al final. */
export interface BuildHooks {
  onProgress?: (p: Progress) => void;
  /**
   * Índice a medias, en cuanto se conocen los archivos y sus tamaños (antes de git y del
   * uso). Tiene `complete: false`: los datos de git y de uso todavía no valen.
   */
  onPartial?: (index: HeftIndex) => void;
}

export interface Timings {
  list: number;
  read: number;
  git: number;
  usage: number;
  total: number;
}

export interface HeftIndex {
  root: string;
  /** false en el índice a medias de `onPartial`: solo valen archivos, tamaños y líneas. */
  complete: boolean;
  isGit: boolean;
  head: string | null;
  commitsRead: number;
  files: FileEntry[];
  timings: Timings;
  warnings: string[];
}
