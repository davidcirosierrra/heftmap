import path from 'node:path';
import * as vscode from 'vscode';
import type { BuildOptions, HeftIndex, Progress } from '../core/index.js';
import { i18n, resolveLocale, type I18n, type Locale } from '../i18n/index.js';
import { warningText } from '../i18n/warnings.js';
import { Analysis, type Reason } from './analysis.js';
import { HeftDecorations } from './decorations.js';
import { FoldersProvider } from './folders-view.js';
import { guard, HeftLog } from './log.js';
import { HeftPanel, PANEL_VIEW_TYPE, type PanelHost } from './panel.js';
import { toPanelIndex } from './panel-data.js';
import type { PanelIndex, PanelStatus, WebviewMessage } from './panel-protocol.js';
import { WorkerExitError, workerRunner, type IndexRunner } from './runner.js';
import {
  addFolders,
  coveringFolder,
  fileInScope,
  removeFolder,
  sanitizeScope,
  scopeLabel,
  toggleFolder,
  type Scope,
} from './scope.js';
import { allFolders, buildFolderTree, type FolderTree, type TreeNode } from './tree-model.js';

/**
 * Comandos, menú contextual del explorador, barra de estado, la vista lateral «Carpetas»
 * (`folders-view.ts`) y el panel (`panel.ts`). Los textos salen de src/i18n en el idioma del
 * editor o el de `heftmap.language`.
 *
 * El análisis no corre aquí: `analysis.ts` lo planifica y lo lanza en un worker (`runner.ts`,
 * `worker.ts`) para no bloquear el proceso de extensiones. Este archivo no debe importar el núcleo salvo tipos,
 * o TypeScript acabaría también en este bundle.
 */

const VIEW_ID = 'heftmap.folders';
const SCOPE_KEY = 'heftmap.scope';

/** Idioma de Heftmap: el ajuste `heftmap.language` o, en «auto», el del editor. */
export function currentLocale(): Locale {
  const chosen = vscode.workspace.getConfiguration('heftmap').get<string>('language');
  return chosen && chosen !== 'auto' ? resolveLocale(chosen) : resolveLocale(vscode.env.language);
}

/** `runner` solo se pasa en los tests; el editor llama a `activate(context)`. */
export function activate(
  context: vscode.ExtensionContext,
  runner: IndexRunner = workerRunner(path.join(context.extensionPath, 'dist', 'worker.cjs')),
): void {
  let heft: Heft | undefined;
  const log = new HeftLog(() => heft?.I ?? i18n(currentLocale()));
  context.subscriptions.push(log);
  log.start(String((context as { extension?: vscode.Extension<unknown> }).extension?.packageJSON?.version ?? 'dev'), {
    locale: currentLocale(),
    trusted: vscode.workspace.isTrusted,
    folders: String(vscode.workspace.workspaceFolders?.length ?? 0),
  });
  try {
    heft = new Heft(context, log, runner);
    context.subscriptions.push(heft);
    void guard(log, 'start', () => heft?.start())();
  } catch (err) {
    log.error('activate', err, { notify: true });
  }
}

export function deactivate(): void {
  // Todo se libera con context.subscriptions.
}

class Heft implements vscode.Disposable, PanelHost {
  private index: HeftIndex | undefined;
  private tree: FolderTree | undefined;
  /** Cuándo llegó el índice actual: el panel lo enseña como «última actualización». */
  private indexAt = 0;
  private scope: string[];
  private error: string | undefined;
  /** Rutas del índice actual, para descartar eventos de disco que no le afectan. */
  private known = new Set<string>();
  /** Planifica, lanza y cancela los análisis, y vigila el disco. */
  private readonly analysis: Analysis;

  private readonly provider: FoldersProvider;
  private readonly view: vscode.TreeView<TreeNode>;
  private readonly status: vscode.StatusBarItem;
  private readonly panel: HeftPanel;
  private readonly disposables: vscode.Disposable[] = [];
  /** Textos y formatos en el idioma activo. */
  I: I18n = i18n(currentLocale());

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: HeftLog,
    runner: IndexRunner,
  ) {
    this.scope = sanitizeScope(context.workspaceState.get(SCOPE_KEY));
    this.analysis = new Analysis(runner, log, {
      options: (root) => this.analysisOptions(root),
      inIndex: (rel) => this.known.has(rel) || !!this.tree?.byPath.has(rel),
      isGit: () => !!this.index?.isGit,
      onStart: () => this.render(),
      onLaunched: (done) => {
        // Barra de progreso nativa sobre la vista mientras dure este análisis.
        void vscode.window.withProgress({ location: { viewId: VIEW_ID } }, async () => {
          try {
            await done;
          } catch {
            // El error se trata en onError; aquí solo se espera.
          }
        });
      },
      onProgress: () => this.renderStatus(),
      onPartial: (partial) => {
        // Solo la primera vez: con un índice completo en pantalla, uno a medias sería ir a peor.
        if (this.index?.complete) return;
        this.setIndex(partial);
        this.render();
      },
      onComplete: (index, reason) => this.onIndex(index, reason),
      onError: (err, reason) => this.onAnalysisError(err, reason),
      onEnd: () => this.render(),
    });
    this.provider = new FoldersProvider(this, log);
    this.view = vscode.window.createTreeView(VIEW_ID, {
      treeDataProvider: this.provider,
      showCollapseAll: true,
      manageCheckboxStateManually: true,
    });
    this.status = vscode.window.createStatusBarItem('heftmap.status', vscode.StatusBarAlignment.Left, 0);
    this.status.name = 'Heftmap';
    this.status.command = 'heftmap.pickScope';
    this.panel = new HeftPanel(context.extensionUri, this);

    const cmd = (id: string, fn: (...args: any[]) => unknown): void => {
      this.disposables.push(vscode.commands.registerCommand(id, guard(log, `command ${id}`, fn)));
    };
    const on = <A extends unknown[]>(where: string, fn: (...args: A) => unknown) => guard(log, where, fn);
    cmd('heftmap.refresh', () => this.analysis.rebuild('reason.manual'));
    cmd('heftmap.clearScope', () => this.setScope([]));
    cmd('heftmap.pickScope', () => this.pickScope());
    cmd('heftmap.addToScope', (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
      this.setScope(addFolders(this.scope, this.foldersFromArgs(uri, uris))),
    );
    cmd('heftmap.limitScope', (arg?: vscode.Uri | TreeNode, uris?: vscode.Uri[]) => {
      const folders = isTreeNode(arg) ? (arg.kind === 'dir' ? [arg.path] : []) : this.foldersFromArgs(arg, uris);
      if (folders.length) this.setScope(addFolders([], folders));
    });
    cmd('heftmap.revealInExplorer', (node?: TreeNode) => {
      const uri = node && this.uriOf(node);
      if (uri) return vscode.commands.executeCommand('revealInExplorer', uri);
    });
    cmd('heftmap.showLog', () => this.log.show());
    cmd('heftmap.openPanel', () => this.panel.show());
    cmd('heftmap.copyReport', async () => {
      await vscode.env.clipboard.writeText(this.log.report());
      void vscode.window.showInformationMessage(this.I.t('error.reportCopied'));
    });

    this.disposables.push(
      this.view,
      this.status,
      this.panel,
      vscode.window.registerFileDecorationProvider(new HeftDecorations()),
      // Sin esto el editor cierra la pestaña al recargar la ventana (SPEC §9, fase 2).
      vscode.window.registerWebviewPanelSerializer(PANEL_VIEW_TYPE, {
        deserializeWebviewPanel: async (restored: vscode.WebviewPanel) => {
          await on('restore panel', () => this.panel.restore(restored))();
        },
      }),
      this.view.onDidChangeCheckboxState(on('checkbox', (e: vscode.TreeCheckboxChangeEvent<TreeNode>) => this.onCheckboxes(e))),
      vscode.workspace.onDidChangeConfiguration(on('settings change', (e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration('heftmap.language')) {
          // Solo cambia cómo se dice: se repinta sin volver a analizar.
          this.I = i18n(currentLocale());
          this.render();
          this.panel.indexChanged();
          return;
        }
        if (e.affectsConfiguration('heftmap')) this.analysis.schedule('reason.settings');
      })),
      vscode.workspace.onDidChangeWorkspaceFolders(on('workspace folders', () => this.start())),
      vscode.workspace.onDidGrantWorkspaceTrust(on('workspace trust', () => this.analysis.rebuild('reason.trust'))),
    );
  }

  async start(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const previous = this.root?.toString();
    const root = folders[0]?.uri;
    this.analysis.setRoot(root);
    // Otra carpeta: el índice de la anterior no vale ni como «anterior mientras se reanaliza».
    if (previous && previous !== root?.toString()) this.clearIndex();
    if (!root) {
      this.clearIndex();
      this.render();
      return;
    }
    if (folders.length > 1) {
      this.log.info(this.I.t('log.multiRoot', { n: folders.length, name: folders[0]?.name ?? '' }));
    }
    this.analysis.watch();
    await this.analysis.rebuild('reason.start');
  }

  // ---------------------------------------------------------------- datos

  /** Carpeta analizada: la primera del workspace. */
  private get root(): vscode.Uri | undefined {
    return this.analysis.root;
  }

  getTree(): FolderTree | undefined {
    return this.tree;
  }

  /** false mientras solo se conocen los tamaños (primer análisis en curso). */
  isComplete(): boolean {
    return this.index?.complete ?? false;
  }

  getScope(): Scope {
    return this.scope;
  }

  getRoot(): vscode.Uri | undefined {
    return this.root;
  }

  uriOf(node: TreeNode): vscode.Uri | undefined {
    if (!this.root) return undefined;
    return vscode.Uri.joinPath(this.root, node.kind === 'dir' ? node.path : node.file.path);
  }

  private analysisOptions(root: vscode.Uri): BuildOptions {
    const cfg = vscode.workspace.getConfiguration('heftmap', root);
    return {
      publicDir: cfg.get<string>('publicDir') || 'public',
      since: cfg.get<string>('git.since') || undefined,
      ignore: cfg.get<string[]>('usage.ignore') ?? [],
      entryPoints: cfg.get<string[]>('usage.entryPoints') ?? [],
      // Workspace sin confianza: git podría ejecutar programas que trae el propio repo (SPEC §3.6).
      useGit: vscode.workspace.isTrusted,
    };
  }

  private onIndex(index: HeftIndex, reason: Reason): void {
    this.setIndex(index);
    this.error = undefined;
    // Carpetas del ámbito que ya no existen (borradas, renombradas): no tendrían casilla que desmarcar.
    const alive = this.scope.filter((s) => this.tree?.byPath.has(s));
    if (alive.length !== this.scope.length) {
      this.log.info(`${this.I.t('log.scopeGone', { folders: this.scope.filter((s) => !alive.includes(s)).join(', ') })}`);
      this.scope = alive;
      void this.context.workspaceState.update(SCOPE_KEY, alive);
    }
    const t = index.timings;
    const I = this.I;
    this.log.info(
      I.t('log.index', {
        reason: I.t(reason),
        files: I.tp('files', index.files.length),
        commits: I.num(index.commitsRead),
        list: I.ms(t.list),
        read: I.ms(t.read),
        git: I.ms(t.git),
        usage: I.ms(t.usage),
        total: I.ms(t.total),
      }),
    );
    for (const w of index.warnings) this.log.warn(warningText(w, I));
  }

  private onAnalysisError(err: unknown, reason: Reason): void {
    this.error =
      err instanceof WorkerExitError ? this.I.t('error.workerExit', { code: err.code }) : err instanceof Error ? err.message : String(err);
    // Ya se enseña en la vista y en el panel; el aviso es para saber que el fallo es de Heftmap.
    this.log.error(`analysis (${reason})`, err, { notify: true, detail: this.I.t('log.indexError', { error: this.error }) });
  }

  private setIndex(index: HeftIndex): void {
    this.index = index;
    this.indexAt = Date.now();
    this.tree = buildFolderTree(index);
    this.known = new Set(index.files.map((f) => f.path));
    this.panel.indexChanged();
  }

  private clearIndex(): void {
    this.index = undefined;
    this.tree = undefined;
    this.known = new Set();
    this.panel.indexChanged();
  }

  // ---------------------------------------------------------------- panel

  panelIndex(): PanelIndex | null {
    if (!this.index || !this.root) return null;
    return toPanelIndex(this.index, path.basename(this.root.fsPath), this.indexAt);
  }

  panelStatus(): PanelStatus {
    const p = this.analysis.building ? this.analysis.progress : undefined;
    return {
      hasRoot: !!this.root,
      scope: [...this.scope],
      building: this.analysis.building,
      progress: this.analysis.building ? progressLabel(this.analysis.progress, this.I) : null,
      fraction: p && p.total > 0 ? p.done / p.total : null,
      error: this.error ?? null,
      locale: this.I.locale,
    };
  }

  /** Lo que llega del webview no se da por bueno: solo se abren rutas que están en el índice. */
  onPanelMessage(m: WebviewMessage): void {
    try {
      this.handlePanelMessage(m);
    } catch (err) {
      this.log.error(`panel message ${String((m as { type?: unknown })?.type)}`, err, { notify: true });
    }
  }

  private handlePanelMessage(m: WebviewMessage): void {
    if (m.type === 'open') {
      if (this.root && typeof m.path === 'string' && this.known.has(m.path)) {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(this.root, m.path));
      }
    } else if (m.type === 'reveal') {
      if (this.root && typeof m.path === 'string' && this.known.has(m.path)) {
        void vscode.commands.executeCommand('revealInExplorer', vscode.Uri.joinPath(this.root, m.path));
      }
    } else if (m.type === 'diff') {
      if (this.root && typeof m.path === 'string' && this.known.has(m.path)) {
        // Comando de la extensión de git integrada: diff del árbol de trabajo contra HEAD.
        void vscode.commands.executeCommand('git.openChange', vscode.Uri.joinPath(this.root, m.path));
      }
    } else if (m.type === 'ignoreUsage') {
      if (typeof m.path === 'string' && this.known.has(m.path)) void this.ignoreUsage(m.path);
    } else if (m.type === 'trash') {
      if (typeof m.path === 'string') void this.trash(m.path);
    } else if (m.type === 'removeScope') {
      if (typeof m.folder === 'string') this.setScope(removeFolder(this.scope, m.folder));
    } else if (m.type === 'clearScope') this.setScope([]);
    else if (m.type === 'pickScope') void this.pickScope();
    else if (m.type === 'refresh') void this.analysis.rebuild('reason.manual');
    else if (m.type === 'showLog') this.log.show();
    else if (m.type === 'copy') {
      if (typeof m.text === 'string') void vscode.env.clipboard.writeText(m.text);
    } else if (m.type === 'error') {
      // El panel ya enseña su propia pantalla de error: aquí solo se registra.
      const err = Object.assign(new Error(String(m.message)), { stack: typeof m.stack === 'string' ? m.stack.split('\n').slice(0, 40).join('\n') : undefined });
      this.log.error(`panel (${String(m.where)})`, err);
    }
  }

  /** «Ignorar este archivo»: a `heftmap.usage.ignore` del workspace. El cambio de ajuste reanaliza. */
  private async ignoreUsage(file: string): Promise<void> {
    if (!this.root) return;
    const cfg = vscode.workspace.getConfiguration('heftmap', this.root);
    const list = cfg.get<string[]>('usage.ignore') ?? [];
    if (list.includes(file)) return;
    try {
      await cfg.update('usage.ignore', [...list, file].sort(), vscode.ConfigurationTarget.Workspace);
      this.log.info(this.I.t('log.ignored', { path: file }));
    } catch (err) {
      void vscode.window.showErrorMessage(this.I.t('ignore.failed', { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  /**
   * «Mover a la papelera…»: solo archivos que el índice actual da por «sin rastro», y
   * siempre con confirmación. Nunca se borra nada sin preguntar (SPEC §2.2).
   */
  private async trash(file: string): Promise<void> {
    const entry = this.index?.complete ? this.index.files.find((f) => f.path === file) : undefined;
    if (!this.root || !entry || entry.usage !== 'none') return;
    const I = this.I;
    const action = I.t('trash.action');
    const answer = await vscode.window.showWarningMessage(
      I.t('trash.confirm', { path: file }),
      { modal: true, detail: I.t('trash.detail', { size: I.size(entry.size) }) },
      action,
    );
    if (answer !== action) return;
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.root, file), { useTrash: true });
      this.log.info(I.t('log.trashed', { path: file, size: I.size(entry.size) }));
      this.analysis.schedule('reason.trash');
    } catch (err) {
      void vscode.window.showErrorMessage(I.t('trash.failed', { path: file, error: err instanceof Error ? err.message : String(err) }));
    }
  }

  // ---------------------------------------------------------------- ámbito

  private setScope(scope: string[]): void {
    this.scope = scope;
    void this.context.workspaceState.update(SCOPE_KEY, scope);
    this.render();
  }

  private onCheckboxes(e: vscode.TreeCheckboxChangeEvent<TreeNode>): void {
    let scope = [...this.scope];
    for (const [node, state] of e.items) {
      if (node.kind !== 'dir') continue;
      const result = toggleFolder(scope, node.path, state === vscode.TreeItemCheckboxState.Checked);
      if (result.kind === 'changed') scope = result.scope;
      else {
        void vscode.window.showInformationMessage(this.I.t('scope.blocked', { folder: node.path, by: result.by }));
      }
    }
    this.setScope(scope);
  }

  private async pickScope(): Promise<void> {
    if (!this.tree) {
      void vscode.window.showInformationMessage(this.I.t('scope.stillAnalyzing'));
      return;
    }
    type Item = vscode.QuickPickItem & { path: string };
    const items: Item[] = allFolders(this.tree).map((d) => ({
      label: `$(folder) ${d.path}/`,
      description: `${this.I.size(d.size)} · ${this.I.t('tree.filesShort', { n: this.I.num(d.count) })}`,
      path: d.path,
      picked: coveringFolder(this.scope, d.path) !== undefined,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: this.I.t('scope.pickTitle'),
      placeHolder: this.I.t('scope.pickPlaceholder'),
      matchOnDescription: false,
    });
    if (picked) this.setScope(addFolders([], picked.map((p) => p.path)));
  }

  /** Argumentos del menú contextual del explorador: carpeta pulsada o selección múltiple. */
  private foldersFromArgs(uri?: vscode.Uri, uris?: vscode.Uri[]): string[] {
    const list = uris?.length ? uris : uri ? [uri] : [];
    if (!this.root) return [];
    const rootPath = this.root.fsPath;
    const rels = list
      .map((u) => path.relative(rootPath, u.fsPath).split(path.sep).join('/'))
      .filter((r) => r && !r.startsWith('..') && !path.isAbsolute(r));
    // Solo carpetas con archivos en el índice: una ignorada por git (node_modules, dist) o un
    // archivo de una selección múltiple dejarían un ámbito vacío e imposible de desmarcar.
    const tree = this.tree;
    if (!tree) return rels;
    const valid = rels.filter((r) => tree.byPath.has(r));
    if (valid.length < rels.length) {
      const skipped = rels.filter((r) => !valid.includes(r));
      void vscode.window.showInformationMessage(this.I.t('scope.skipped', { folders: skipped.map((s) => `«${s}»`).join(', ') }));
    }
    return valid;
  }

  // ---------------------------------------------------------------- pintado

  private render(): void {
    this.provider.refresh();
    this.renderStatus();
  }

  /** Descripción de la vista y barra de estado, sin repintar el árbol (se llama en cada avance). */
  private renderStatus(): void {
    const I = this.I;
    const label = scopeLabel(this.scope, I.t('scope.all'));
    // Total del ámbito junto al título de la vista (el panel ya lo enseña; aquí faltaba).
    const totals = this.scopeTotals();
    const summary = totals ? `${label} · ${I.size(totals.size)} · ${I.tp('files', totals.count)}` : label;
    this.view.description = this.analysis.building ? I.t('view.analyzingSuffix', { scope: summary }) : summary;
    this.view.message = this.error
      ? I.t('view.error', { error: this.error })
      : (this.firstScanMessage() ?? (this.root && !vscode.workspace.isTrusted ? I.t('view.restricted') : undefined));
    this.panel.statusChanged();

    if (!this.root) {
      this.status.hide();
      return;
    }
    if (this.analysis.building) {
      this.status.text = `$(sync~spin) ${I.t('status.analyzing', { progress: progressLabel(this.analysis.progress, I) })}`;
    } else if (!this.index) {
      this.status.text = '$(layers) Heftmap';
    } else {
      const t = totals ?? { size: 0, count: 0 };
      this.status.text = `$(layers) ${I.t('status.text', { scope: label, files: I.tp('files', t.count), size: I.size(t.size) })}`;
    }
    this.status.tooltip = I.t('status.tooltip');
    this.status.show();
  }

  /** Archivos y tamaño del ámbito (el repo entero si no hay ámbito); undefined sin índice. */
  private scopeTotals(): { size: number; count: number } | undefined {
    if (!this.index) return undefined;
    let size = 0;
    let count = 0;
    for (const f of this.index.files) {
      if (f.ignoredByGit || !fileInScope(this.scope, f.path)) continue;
      size += f.size;
      count++;
    }
    return { size, count };
  }

  /**
   * Texto sobre el árbol durante el primer análisis: en un repo grande el árbol tarda en
   * aparecer y la barra de progreso nativa sola no deja claro que Heftmap está trabajando.
   */
  private firstScanMessage(): string | undefined {
    if (!this.analysis.building || this.index?.complete) return undefined;
    const progress = this.analysis.progress;
    const step = progress ? ` (${progressLabel(progress, this.I)})` : '';
    return this.I.t(this.index ? 'view.sizesReady' : 'view.firstScan', { step });
  }

  dispose(): void {
    this.analysis.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function isTreeNode(x: unknown): x is TreeNode {
  return !!x && typeof x === 'object' && 'kind' in x && ((x as TreeNode).kind === 'dir' || (x as TreeNode).kind === 'file');
}

/** «uso 1200/3006», o solo la fase si no se puede medir. */
export function progressLabel(p: Progress | undefined, I: I18n): string {
  if (!p) return I.t('progress.analyzing');
  const phase = I.t(`phase.${p.phase}`);
  return p.total > 0 ? I.t('progress.step', { phase, done: I.num(p.done), total: I.num(p.total) }) : I.t('progress.phaseOnly', { phase });
}

