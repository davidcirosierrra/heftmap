import path from 'node:path';
import * as vscode from 'vscode';
import { git } from '../core/git.js';
import type { BuildOptions, HeftIndex, Progress } from '../core/index.js';
import type { MessageKey } from '../i18n/index.js';
import { guard, type HeftLog } from './log.js';
import { CancelledError, type IndexJob, type IndexRunner } from './runner.js';

/**
 * Ciclo de análisis: planificar (con retardo), lanzar en el worker, cancelar el anterior,
 * descartar resultados viejos por número de generación, seguir el progreso y vigilar el disco.
 * No guarda el índice ni pinta nada: avisa a quien lo usa (`AnalysisListener`) y este decide.
 */

/** Por qué se lanza un análisis; el texto sale al registro. */
export type Reason = Extract<MessageKey, `reason.${string}`>;

/**
 * Lo que el ciclo necesita saber de quien lo usa y a quién avisa. Los avisos se llaman en orden
 * y dentro del mismo `try` que el análisis: un fallo al recibir el índice cuenta como fallo del
 * análisis, igual que antes de separar este archivo.
 */
export interface AnalysisListener {
  /** Opciones del análisis para esta raíz (ajustes, confianza del workspace). */
  options(root: vscode.Uri): BuildOptions;
  /** ¿Está esta ruta relativa en el índice actual? Para descartar eventos de disco ajenos. */
  inIndex(rel: string): boolean;
  /** ¿El índice actual es de un repo git? Sin índice, false. */
  isGit(): boolean;
  /** Espera (ms) antes de un análisis planificado y si los cambios en disco lo relanzan. */
  refresh(): { delay: number; auto: boolean };
  /** Empieza un análisis (aún no se ha lanzado el worker). */
  onStart(): void;
  /** El análisis ya está lanzado; `done` se resuelve (o falla) cuando termina. */
  onLaunched(done: Promise<unknown>): void;
  onProgress(p: Progress): void;
  /** Índice a medias (solo tamaños) del análisis en curso. */
  onPartial(index: HeftIndex): void;
  onComplete(index: HeftIndex, reason: Reason): void;
  /** Falló el análisis en curso (no se llama si se canceló o lo sustituyó otro). */
  onError(err: unknown, reason: Reason): void;
  /** Terminó el análisis en curso, bien o mal: ya no hay nada en marcha. */
  onEnd(): void;
}

export class Analysis implements vscode.Disposable {
  private currentRoot: vscode.Uri | undefined;
  private isBuilding = false;
  /** Análisis en curso y su número: un resultado de un análisis anterior se descarta. */
  private job: IndexJob | undefined;
  private generation = 0;
  private currentProgress: Progress | undefined;
  private timer: NodeJS.Timeout | undefined;
  /** Vigilancia de la carpeta analizada; se sustituye si cambia la raíz. */
  private watching: vscode.Disposable[] = [];

  constructor(
    private readonly runner: IndexRunner,
    private readonly log: HeftLog,
    private readonly listener: AnalysisListener,
  ) {}

  get root(): vscode.Uri | undefined {
    return this.currentRoot;
  }

  get building(): boolean {
    return this.isBuilding;
  }

  /** Avance del análisis en curso; undefined si no hay o aún no ha dicho nada. */
  get progress(): Progress | undefined {
    return this.currentProgress;
  }

  /** Cambia la carpeta analizada y deja de vigilar la anterior. No lanza el análisis. */
  setRoot(root: vscode.Uri | undefined): void {
    this.currentRoot = root;
    this.stopWatching();
  }

  /** Vigila la carpeta analizada: un cambio que afecte al índice planifica otro análisis. */
  watch(): void {
    const root = this.currentRoot;
    this.stopWatching();
    if (!root) return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
    this.watching = [
      watcher,
      watcher.onDidCreate(guard(this.log, 'file watcher', (uri: vscode.Uri) => this.onFs(uri, 'create'))),
      watcher.onDidChange(guard(this.log, 'file watcher', (uri: vscode.Uri) => this.onFs(uri, 'change'))),
      watcher.onDidDelete(guard(this.log, 'file watcher', (uri: vscode.Uri) => this.onFs(uri, 'delete'))),
    ];
  }

  private stopWatching(): void {
    for (const d of this.watching) d.dispose();
    this.watching = [];
  }

  /**
   * Un cambio en disco solo relanza el análisis si puede cambiar el índice. Lo que git
   * ignora (dist/, node_modules/, cachés) no está en él: sin este filtro, cada build del
   * proyecto analizado provocaría un análisis completo.
   */
  private async onFs(uri: vscode.Uri, kind: 'create' | 'change' | 'delete'): Promise<void> {
    const root = this.currentRoot;
    // Con `heftmap.autoRefresh` desactivado solo se reanaliza a mano (o al cambiar un ajuste).
    if (!root || !this.listener.refresh().auto) return;
    const p = uri.path;
    if (p.includes('/.git/') || p.endsWith('/.git')) {
      // Dentro de .git solo interesa un cambio de HEAD o de ramas (nuevo commit).
      if (/\/\.git\/(HEAD|refs\/)/.test(p)) this.schedule('reason.git');
      return;
    }
    const rel = path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
    if (this.listener.isGit() && rel && !rel.startsWith('..') && !this.listener.inIndex(rel)) {
      // Modificar o borrar algo que no está en el índice no lo cambia.
      if (kind !== 'create') return;
      if (await isIgnoredByGit(root.fsPath, rel)) return;
    }
    this.schedule('reason.disk');
  }

  /** Lanza un análisis dentro de un rato; si llega otra petición antes, cuenta solo la última. */
  schedule(reason: Reason): void {
    clearTimeout(this.timer);
    const { delay } = this.listener.refresh();
    this.timer = setTimeout(() => void guard(this.log, 'scheduled analysis', () => this.rebuild(reason))(), delay);
  }

  /** Lanza un análisis ya. Si había otro en curso se cancela: sus datos ya son viejos. */
  async rebuild(reason: Reason): Promise<void> {
    const root = this.currentRoot;
    if (!root) return;
    this.job?.cancel();
    const generation = ++this.generation;
    const current = (): boolean => generation === this.generation;
    this.isBuilding = true;
    this.currentProgress = undefined;
    const listener = this.listener;
    listener.onStart();

    const job = this.runner(root.fsPath, listener.options(root), {
      onProgress: (p) => {
        if (!current()) return;
        this.currentProgress = p;
        listener.onProgress(p);
      },
      onPartial: (partial) => {
        if (current()) listener.onPartial(partial);
      },
    });
    this.job = job;
    listener.onLaunched(job.result);

    try {
      const index = await job.result;
      if (!current()) return;
      listener.onComplete(index, reason);
    } catch (err) {
      if (!current() || err instanceof CancelledError) return;
      listener.onError(err, reason);
    } finally {
      if (current()) {
        this.isBuilding = false;
        this.job = undefined;
        this.currentProgress = undefined;
        listener.onEnd();
      }
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.generation++;
    this.job?.cancel();
    this.stopWatching();
  }
}

/** `git check-ignore` sale con 0 si la ruta está ignorada y con 1 si no. */
async function isIgnoredByGit(root: string, rel: string): Promise<boolean> {
  try {
    await git(root, ['check-ignore', '-q', '--', rel]);
    return true;
  } catch {
    return false;
  }
}
