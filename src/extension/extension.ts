import path from 'node:path';
import * as vscode from 'vscode';
import { git } from '../core/git.js';
import type { FileEntry, HeftIndex, Progress } from '../core/index.js';
import { i18n, resolveLocale, type I18n, type Locale, type MessageKey } from '../i18n/index.js';
import { warningText } from '../i18n/warnings.js';
import { bar, weightTier, type WeightTier } from './bars.js';
import { guard, guardSync, HeftLog } from './log.js';
import { HeftPanel, PANEL_VIEW_TYPE, type PanelHost } from './panel.js';
import { toPanelIndex } from './panel-data.js';
import type { PanelIndex, PanelStatus, WebviewMessage } from './panel-protocol.js';
import { CancelledError, WorkerExitError, workerRunner, type IndexJob, type IndexRunner } from './runner.js';
import {
  addFolders,
  coveredByAncestor,
  coveringFolder,
  fileInScope,
  removeFolder,
  sanitizeScope,
  scopeLabel,
  toggleFolder,
  type Scope,
} from './scope.js';
import { allFolders, buildFolderTree, childrenOf, share, type DirNode, type FolderTree, type TreeNode } from './tree-model.js';

/**
 * Vista lateral «Carpetas», comandos, menú contextual del explorador, barra de estado y panel
 * (`panel.ts`). Los textos salen de src/i18n en el idioma del editor o el de `heft.language`.
 *
 * El análisis no corre aquí: se lanza en un worker (`runner.ts`, `worker.ts`) para no
 * bloquear el proceso de extensiones. Este archivo no debe importar el núcleo salvo tipos,
 * o TypeScript acabaría también en este bundle.
 */

const VIEW_ID = 'heft.folders';
const SCOPE_KEY = 'heft.scope';
const REBUILD_DELAY_MS = 1500;

type Reason = Extract<MessageKey, `reason.${string}`>;

/** Idioma de Heft: el ajuste `heft.language` o, en «auto», el del editor. */
export function currentLocale(): Locale {
  const chosen = vscode.workspace.getConfiguration('heft').get<string>('language');
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
  private root: vscode.Uri | undefined;
  private index: HeftIndex | undefined;
  private tree: FolderTree | undefined;
  /** Cuándo llegó el índice actual: el panel lo enseña como «última actualización». */
  private indexAt = 0;
  private scope: string[];
  private building = false;
  /** Análisis en curso y su número: un resultado de un análisis anterior se descarta. */
  private job: IndexJob | undefined;
  private generation = 0;
  private progress: Progress | undefined;
  private timer: NodeJS.Timeout | undefined;
  private error: string | undefined;
  /** Rutas del índice actual, para descartar eventos de disco que no le afectan. */
  private known = new Set<string>();
  /** Vigilancia de la carpeta analizada; se sustituye si cambia la raíz. */
  private watching: vscode.Disposable[] = [];

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
    private readonly runner: IndexRunner,
  ) {
    this.scope = sanitizeScope(context.workspaceState.get(SCOPE_KEY));
    this.provider = new FoldersProvider(this, log);
    this.view = vscode.window.createTreeView(VIEW_ID, {
      treeDataProvider: this.provider,
      showCollapseAll: true,
      manageCheckboxStateManually: true,
    });
    this.status = vscode.window.createStatusBarItem('heft.status', vscode.StatusBarAlignment.Left, 0);
    this.status.name = 'Heft';
    this.status.command = 'heft.pickScope';
    this.panel = new HeftPanel(context.extensionUri, this);

    const cmd = (id: string, fn: (...args: any[]) => unknown): void => {
      this.disposables.push(vscode.commands.registerCommand(id, guard(log, `command ${id}`, fn)));
    };
    const on = <A extends unknown[]>(where: string, fn: (...args: A) => unknown) => guard(log, where, fn);
    cmd('heft.refresh', () => this.rebuild('reason.manual'));
    cmd('heft.clearScope', () => this.setScope([]));
    cmd('heft.pickScope', () => this.pickScope());
    cmd('heft.addToScope', (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
      this.setScope(addFolders(this.scope, this.foldersFromArgs(uri, uris))),
    );
    cmd('heft.limitScope', (arg?: vscode.Uri | TreeNode, uris?: vscode.Uri[]) => {
      const folders = isTreeNode(arg) ? (arg.kind === 'dir' ? [arg.path] : []) : this.foldersFromArgs(arg, uris);
      if (folders.length) this.setScope(addFolders([], folders));
    });
    cmd('heft.revealInExplorer', (node?: TreeNode) => {
      const uri = node && this.uriOf(node);
      if (uri) return vscode.commands.executeCommand('revealInExplorer', uri);
    });
    cmd('heft.showLog', () => this.log.show());
    cmd('heft.openPanel', () => this.panel.show());
    cmd('heft.copyReport', async () => {
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
        if (e.affectsConfiguration('heft.language')) {
          // Solo cambia cómo se dice: se repinta sin volver a analizar.
          this.I = i18n(currentLocale());
          this.render();
          this.panel.indexChanged();
          return;
        }
        if (e.affectsConfiguration('heft')) this.schedule('reason.settings');
      })),
      vscode.workspace.onDidChangeWorkspaceFolders(on('workspace folders', () => this.start())),
      vscode.workspace.onDidGrantWorkspaceTrust(on('workspace trust', () => this.rebuild('reason.trust'))),
    );
  }

  async start(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const previous = this.root?.toString();
    this.root = folders[0]?.uri;
    this.stopWatching();
    // Otra carpeta: el índice de la anterior no vale ni como «anterior mientras se reanaliza».
    if (previous && previous !== this.root?.toString()) this.clearIndex();
    if (!this.root) {
      this.clearIndex();
      this.render();
      return;
    }
    if (folders.length > 1) {
      this.log.info(this.I.t('log.multiRoot', { n: folders.length, name: folders[0]?.name ?? '' }));
    }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, '**/*'));
    this.watching = [
      watcher,
      watcher.onDidCreate(guard(this.log, 'file watcher', (uri: vscode.Uri) => this.onFs(uri, 'create'))),
      watcher.onDidChange(guard(this.log, 'file watcher', (uri: vscode.Uri) => this.onFs(uri, 'change'))),
      watcher.onDidDelete(guard(this.log, 'file watcher', (uri: vscode.Uri) => this.onFs(uri, 'delete'))),
    ];
    await this.rebuild('reason.start');
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
    const root = this.root;
    if (!root) return;
    const p = uri.path;
    if (p.includes('/.git/') || p.endsWith('/.git')) {
      // Dentro de .git solo interesa un cambio de HEAD o de ramas (nuevo commit).
      if (/\/\.git\/(HEAD|refs\/)/.test(p)) this.schedule('reason.git');
      return;
    }
    const rel = path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
    const inIndex = this.known.has(rel) || this.tree?.byPath.has(rel);
    if (this.index?.isGit && rel && !rel.startsWith('..') && !inIndex) {
      // Modificar o borrar algo que no está en el índice no lo cambia.
      if (kind !== 'create') return;
      if (await isIgnoredByGit(root.fsPath, rel)) return;
    }
    this.schedule('reason.disk');
  }

  // ---------------------------------------------------------------- datos

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

  private schedule(reason: Reason): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void guard(this.log, 'scheduled analysis', () => this.rebuild(reason))(), REBUILD_DELAY_MS);
  }

  /**
   * Lanza un análisis. Si había otro en curso se cancela: sus datos ya son viejos.
   * La vista enseña una barra de progreso y la barra de estado, la fase y el avance.
   */
  private async rebuild(reason: Reason): Promise<void> {
    const root = this.root;
    if (!root) return;
    this.job?.cancel();
    const generation = ++this.generation;
    const current = (): boolean => generation === this.generation;
    this.building = true;
    this.progress = undefined;
    this.render();

    const cfg = vscode.workspace.getConfiguration('heft', root);
    const job = this.runner(
      root.fsPath,
      {
        publicDir: cfg.get<string>('publicDir') || 'public',
        since: cfg.get<string>('git.since') || undefined,
        ignore: cfg.get<string[]>('usage.ignore') ?? [],
        entryPoints: cfg.get<string[]>('usage.entryPoints') ?? [],
        // Workspace sin confianza: git podría ejecutar programas que trae el propio repo (SPEC §3.6).
        useGit: vscode.workspace.isTrusted,
      },
      {
        onProgress: (p) => {
          if (!current()) return;
          this.progress = p;
          this.renderStatus();
        },
        onPartial: (partial) => {
          // Solo la primera vez: con un índice completo en pantalla, uno a medias sería ir a peor.
          if (!current() || this.index?.complete) return;
          this.setIndex(partial);
          this.render();
        },
      },
    );
    this.job = job;
    // Barra de progreso nativa sobre la vista mientras dure este análisis.
    void vscode.window.withProgress({ location: { viewId: VIEW_ID } }, async () => {
      try {
        await job.result;
      } catch {
        // El error se trata abajo; aquí solo se espera.
      }
    });

    try {
      const index = await job.result;
      if (!current()) return;
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
    } catch (err) {
      if (!current() || err instanceof CancelledError) return;
      this.error =
        err instanceof WorkerExitError ? this.I.t('error.workerExit', { code: err.code }) : err instanceof Error ? err.message : String(err);
      // Ya se enseña en la vista y en el panel; el aviso es para saber que el fallo es de Heft.
      this.log.error(`analysis (${reason})`, err, { notify: true, detail: this.I.t('log.indexError', { error: this.error }) });
    } finally {
      if (current()) {
        this.building = false;
        this.job = undefined;
        this.progress = undefined;
        this.render();
      }
    }
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
    const p = this.building ? this.progress : undefined;
    return {
      hasRoot: !!this.root,
      scope: [...this.scope],
      building: this.building,
      progress: this.building ? progressLabel(this.progress, this.I) : null,
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
    else if (m.type === 'refresh') void this.rebuild('reason.manual');
    else if (m.type === 'showLog') this.log.show();
    else if (m.type === 'copy') {
      if (typeof m.text === 'string') void vscode.env.clipboard.writeText(m.text);
    } else if (m.type === 'error') {
      // El panel ya enseña su propia pantalla de error: aquí solo se registra.
      const err = Object.assign(new Error(String(m.message)), { stack: typeof m.stack === 'string' ? m.stack.split('\n').slice(0, 40).join('\n') : undefined });
      this.log.error(`panel (${String(m.where)})`, err);
    }
  }

  /** «Ignorar este archivo»: a `heft.usage.ignore` del workspace. El cambio de ajuste reanaliza. */
  private async ignoreUsage(file: string): Promise<void> {
    if (!this.root) return;
    const cfg = vscode.workspace.getConfiguration('heft', this.root);
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
      this.schedule('reason.trash');
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
    this.view.description = this.building ? I.t('view.analyzingSuffix', { scope: summary }) : summary;
    this.view.message = this.error
      ? I.t('view.error', { error: this.error })
      : (this.firstScanMessage() ?? (this.root && !vscode.workspace.isTrusted ? I.t('view.restricted') : undefined));
    this.panel.statusChanged();

    if (!this.root) {
      this.status.hide();
      return;
    }
    if (this.building) {
      this.status.text = `$(sync~spin) ${I.t('status.analyzing', { progress: progressLabel(this.progress, I) })}`;
    } else if (!this.index) {
      this.status.text = '$(layers) Heft';
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
   * URI con el que la vista pinta un elemento: el del archivo con `?heft=<tramo>`. Los iconos
   * del tema salen igual (dependen del nombre), y el color por peso (`HeftDecorations`) solo
   * se aplica a estos URI: el explorador nativo y las pestañas no se tiñen.
   */
  decoratedUri(uri: vscode.Uri | undefined, fraction: number): vscode.Uri | undefined {
    return uri?.with({ query: `heft=${weightTier(fraction) ?? 'none'}` });
  }

  /**
   * Texto sobre el árbol durante el primer análisis: en un repo grande el árbol tarda en
   * aparecer y la barra de progreso nativa sola no deja claro que Heft está trabajando.
   */
  private firstScanMessage(): string | undefined {
    if (!this.building || this.index?.complete) return undefined;
    const step = this.progress ? ` (${progressLabel(this.progress, this.I)})` : '';
    return this.I.t(this.index ? 'view.sizesReady' : 'view.firstScan', { step });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.generation++;
    this.job?.cancel();
    this.stopWatching();
    for (const d of this.disposables) d.dispose();
  }
}

class FoldersProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly heft: Heft, log: HeftLog) {
    // Un fallo aquí dejaría la vista vacía sin explicación: se registra y se sigue.
    this.getChildren = guardSync(log, 'folders view', this.getChildren.bind(this), () => []);
    this.getTreeItem = guardSync(log, 'folders view', this.getTreeItem.bind(this), (node: TreeNode) => {
      let label = '?';
      try {
        label = node.kind === 'dir' ? node.name : node.file.path;
      } catch {
        // el nodo está roto: se enseña igualmente, sin datos
      }
      return new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    });
  }

  refresh(): void {
    this.emitter.fire();
  }

  getChildren(node?: TreeNode): TreeNode[] {
    const tree = this.heft.getTree();
    if (!tree) return [];
    if (!node) return childrenOf(tree.root);
    return node.kind === 'dir' ? childrenOf(node) : [];
  }

  getParent(node: TreeNode): TreeNode | undefined {
    const parent = node.parent;
    return parent && parent.path !== '' ? parent : undefined;
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    return node.kind === 'dir' ? this.dirItem(node) : this.fileItem(node.file, node.parent);
  }

  private dirItem(dir: DirNode): vscode.TreeItem {
    const I = this.heft.I;
    const scope = this.heft.getScope();
    const item = new vscode.TreeItem(dir.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `d:${dir.path}`;
    item.resourceUri = this.heft.decoratedUri(this.heft.uriOf(dir), share(dir.size, dir.parent?.size ?? 0));
    item.iconPath = vscode.ThemeIcon.Folder;
    item.contextValue = 'heftDir';
    const dirShare = share(dir.size, dir.parent?.size ?? 0);
    item.description = `${withBar(dirShare)}${I.pct(dirShare)} · ${I.size(dir.size)} · ${I.t('tree.filesShort', { n: I.num(dir.count) })}`;

    const covering = coveringFolder(scope, dir.path);
    const ancestor = coveredByAncestor(scope, dir.path);
    item.checkboxState = {
      state: covering ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked,
      tooltip: ancestor ? I.t('tree.inScopeBy', { folder: ancestor }) : I.t(covering ? 'tree.removeFromScope' : 'tree.addToScope'),
    };
    // Las rutas van como texto: en Markdown `__tests__` se pintaría en negrita y `[id].tsx` como enlace.
    const md = new vscode.MarkdownString();
    md.appendText(`${dir.path}/`);
    md.appendMarkdown('\n\n');
    md.appendText(I.t('tree.dirStats', { size: I.size(dir.size), files: I.tp('files', dir.count), pct: I.pct(share(dir.size, dir.parent?.size ?? 0)) }));
    if (ancestor) {
      md.appendMarkdown('\n\n');
      md.appendText(I.t('tree.inScopeBecause', { folder: `«${ancestor}/»` }));
    }
    item.tooltip = md;
    return item;
  }

  private fileItem(f: FileEntry, parent: DirNode): vscode.TreeItem {
    const I = this.heft.I;
    const uri = this.heft.uriOf({ kind: 'file', file: f, parent });
    const name = f.path.slice(f.path.lastIndexOf('/') + 1);
    const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
    item.id = `f:${f.path}`;
    item.resourceUri = this.heft.decoratedUri(uri, share(f.size, parent.size));
    item.contextValue = 'heftFile';
    const fileShare = share(f.size, parent.size);
    item.description = `${withBar(fileShare)}${I.pct(fileShare)} · ${I.size(f.size)}${f.dirty ? ' ●' : ''}`;
    if (uri) item.command = { command: 'vscode.open', title: I.t('common.open'), arguments: [uri] };

    const md = new vscode.MarkdownString();
    md.appendText(f.path);
    md.appendMarkdown('\n\n');
    md.appendText(`${I.size(f.size)}${f.lines != null ? ` · ${I.tp('lines', f.lines)}` : ''}`);
    if (!this.heft.isComplete()) {
      // Primer análisis a medias: todavía no hay veredicto de uso ni datos de git.
      md.appendMarkdown('\n\n');
      md.appendText(I.t('tree.analyzingUsage'));
      item.tooltip = md;
      return item;
    }
    md.appendText(` · ${I.t(`usage.${f.usage}`)}`);
    if (f.refsIn.length) md.appendText(` (${I.tp('tree.usedBy', f.refsIn.length)})`);
    if (f.lastCommit) {
      const c = f.lastCommit;
      md.appendMarkdown('\n\n');
      md.appendText(`${I.t('tree.lastCommit')} `);
      md.appendMarkdown(`\`${c.short}\` ${escapeMd(c.subject)} — ${escapeMd(c.author)}, `);
      md.appendText(`${I.rel(c.time)} · ${I.tp('changes', f.changes)}`);
    } else if (f.untracked) {
      md.appendMarkdown('\n\n');
      md.appendText(I.t('tree.newFile'));
    }
    if (f.dirty && !f.untracked) {
      md.appendMarkdown('\n\n');
      md.appendText(I.t('tree.uncommitted'));
    }
    item.tooltip = md;
    return item;
  }
}

/** Barra seguida de espacio, o nada si el elemento no pesa. */
function withBar(fraction: number): string {
  const b = bar(fraction);
  return b ? `${b} ` : '';
}

/** Color del nombre por peso dentro de la carpeta padre (la barra, en la descripción, no admite color). */
const TIER_COLOR: Record<WeightTier, string> = {
  heavy: 'charts.red',
  large: 'charts.orange',
  notable: 'charts.yellow',
};

class HeftDecorations implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const tier = /(?:^|&)heft=(\w+)/.exec(uri.query)?.[1];
    if (!tier || !(tier in TIER_COLOR)) return undefined;
    return new vscode.FileDecoration(undefined, undefined, new vscode.ThemeColor(TIER_COLOR[tier as WeightTier]));
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

/** `git check-ignore` sale con 0 si la ruta está ignorada y con 1 si no. */
async function isIgnoredByGit(root: string, rel: string): Promise<boolean> {
  try {
    await git(root, ['check-ignore', '-q', '--', rel]);
    return true;
  } catch {
    return false;
  }
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
