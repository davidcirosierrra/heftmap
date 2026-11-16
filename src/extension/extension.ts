import path from 'node:path';
import * as vscode from 'vscode';
import { git } from '../core/git.js';
import type { FileEntry, HeftIndex, Progress } from '../core/index.js';
import { fmtMs, fmtSize, pct, rel, USAGE_LABEL } from '../report.js';
import { HeftPanel, type PanelHost } from './panel.js';
import { toPanelIndex } from './panel-data.js';
import type { PanelIndex, PanelStatus, WebviewMessage } from './panel-protocol.js';
import { CancelledError, workerRunner, type IndexJob, type IndexRunner } from './runner.js';
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
 * Fases 1 y 2 (SPEC §5): vista lateral «Carpetas» con tamaños y casillas de ámbito, comandos,
 * menú contextual del explorador, barra de estado y panel con la tabla (`panel.ts`).
 *
 * El análisis no corre aquí: se lanza en un worker (`runner.ts`, `worker.ts`) para no
 * bloquear el proceso de extensiones. Este archivo no debe importar el núcleo salvo tipos,
 * o TypeScript acabaría también en este bundle.
 */

const VIEW_ID = 'heft.folders';
const SCOPE_KEY = 'heft.scope';
const REBUILD_DELAY_MS = 1500;

/** `runner` solo se pasa en los tests; el editor llama a `activate(context)`. */
export function activate(
  context: vscode.ExtensionContext,
  runner: IndexRunner = workerRunner(path.join(context.extensionPath, 'dist', 'worker.cjs')),
): void {
  const log = vscode.window.createOutputChannel('Heft');
  const heft = new Heft(context, log, runner);
  context.subscriptions.push(log, heft);
  void heft.start();
}

export function deactivate(): void {
  // Todo se libera con context.subscriptions.
}

class Heft implements vscode.Disposable, PanelHost {
  private root: vscode.Uri | undefined;
  private index: HeftIndex | undefined;
  private tree: FolderTree | undefined;
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

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
    private readonly runner: IndexRunner,
  ) {
    this.scope = sanitizeScope(context.workspaceState.get(SCOPE_KEY));
    this.provider = new FoldersProvider(this);
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
      this.disposables.push(vscode.commands.registerCommand(id, fn));
    };
    cmd('heft.refresh', () => this.rebuild('manual'));
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

    this.disposables.push(
      this.view,
      this.status,
      this.panel,
      this.view.onDidChangeCheckboxState((e) => this.onCheckboxes(e)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('heft')) this.schedule('ajustes');
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.start()),
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
      this.log.appendLine(`Workspace con ${folders.length} carpetas: Heft analiza solo la primera (${folders[0]?.name}).`);
    }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, '**/*'));
    this.watching = [
      watcher,
      watcher.onDidCreate((uri) => void this.onFs(uri, 'create')),
      watcher.onDidChange((uri) => void this.onFs(uri, 'change')),
      watcher.onDidDelete((uri) => void this.onFs(uri, 'delete')),
    ];
    await this.rebuild('inicio');
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
      if (/\/\.git\/(HEAD|refs\/)/.test(p)) this.schedule('cambios en git');
      return;
    }
    const rel = path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
    const inIndex = this.known.has(rel) || this.tree?.byPath.has(rel);
    if (this.index?.isGit && rel && !rel.startsWith('..') && !inIndex) {
      // Modificar o borrar algo que no está en el índice no lo cambia.
      if (kind !== 'create') return;
      if (await isIgnoredByGit(root.fsPath, rel)) return;
    }
    this.schedule('cambios en disco');
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

  private schedule(reason: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.rebuild(reason), REBUILD_DELAY_MS);
  }

  /**
   * Lanza un análisis. Si había otro en curso se cancela: sus datos ya son viejos.
   * La vista enseña una barra de progreso y la barra de estado, la fase y el avance.
   */
  private async rebuild(reason: string): Promise<void> {
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
        this.log.appendLine(`  ámbito: se quitan carpetas que ya no existen (${this.scope.filter((s) => !alive.includes(s)).join(', ')})`);
        this.scope = alive;
        void this.context.workspaceState.update(SCOPE_KEY, alive);
      }
      const t = index.timings;
      this.log.appendLine(
        `[${new Date().toLocaleTimeString('es-ES')}] Índice (${reason}): ${index.files.length} archivos, ` +
          `${index.commitsRead} commits · listado ${fmtMs(t.list)}, lectura ${fmtMs(t.read)}, git ${fmtMs(t.git)}, ` +
          `uso ${fmtMs(t.usage)}, total ${fmtMs(t.total)}`,
      );
      for (const w of index.warnings) this.log.appendLine(`  aviso: ${w}`);
    } catch (err) {
      if (!current() || err instanceof CancelledError) return;
      this.error = err instanceof Error ? err.message : String(err);
      this.log.appendLine(`Error al construir el índice: ${this.error}`);
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
    return toPanelIndex(this.index, path.basename(this.root.fsPath));
  }

  panelStatus(): PanelStatus {
    const p = this.building ? this.progress : undefined;
    return {
      hasRoot: !!this.root,
      scope: [...this.scope],
      building: this.building,
      progress: this.building ? progressLabel(this.progress) : null,
      fraction: p && p.total > 0 ? p.done / p.total : null,
      error: this.error ?? null,
    };
  }

  /** Lo que llega del webview no se da por bueno: solo se abren rutas que están en el índice. */
  onPanelMessage(m: WebviewMessage): void {
    if (m.type === 'open') {
      if (this.root && typeof m.path === 'string' && this.known.has(m.path)) {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(this.root, m.path));
      }
    } else if (m.type === 'reveal') {
      if (this.root && typeof m.path === 'string' && this.known.has(m.path)) {
        void vscode.commands.executeCommand('revealInExplorer', vscode.Uri.joinPath(this.root, m.path));
      }
    } else if (m.type === 'removeScope') {
      if (typeof m.folder === 'string') this.setScope(removeFolder(this.scope, m.folder));
    } else if (m.type === 'clearScope') this.setScope([]);
    else if (m.type === 'pickScope') void this.pickScope();
    else if (m.type === 'refresh') void this.rebuild('manual');
    else if (m.type === 'showLog') this.log.show();
    else if (m.type === 'copy') {
      if (typeof m.text === 'string') void vscode.env.clipboard.writeText(m.text);
    } else if (m.type === 'error') {
      this.log.appendLine(`[${new Date().toLocaleTimeString('es-ES')}] Error en el panel (${String(m.where)}): ${String(m.message)}`);
      if (typeof m.stack === 'string') for (const line of m.stack.split('\n').slice(0, 30)) this.log.appendLine(`  ${line.trim()}`);
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
        void vscode.window.showInformationMessage(
          `«${node.path}/» está en el ámbito porque lo está «${result.by}/». Quita primero «${result.by}/».`,
        );
      }
    }
    this.setScope(scope);
  }

  private async pickScope(): Promise<void> {
    if (!this.tree) {
      void vscode.window.showInformationMessage('Heft todavía está analizando el repositorio.');
      return;
    }
    type Item = vscode.QuickPickItem & { path: string };
    const items: Item[] = allFolders(this.tree).map((d) => ({
      label: `$(folder) ${d.path}/`,
      description: `${fmtSize(d.size)} · ${d.count} arch.`,
      path: d.path,
      picked: coveringFolder(this.scope, d.path) !== undefined,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: 'Heft: carpetas del ámbito',
      placeHolder: 'Marca una o varias carpetas. Ninguna = todo el repositorio.',
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
      void vscode.window.showInformationMessage(
        `Heft no tiene archivos en ${skipped.map((s) => `«${s}»`).join(', ')} (ignorada por git o vacía): no se añade al ámbito.`,
      );
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
    const label = scopeLabel(this.scope);
    this.view.description = this.building ? `${label} · analizando…` : label;
    this.view.message = this.error ? `No se pudo analizar el repositorio: ${this.error}` : this.firstScanMessage();
    this.panel.statusChanged();

    if (!this.root) {
      this.status.hide();
      return;
    }
    if (this.building) {
      this.status.text = `$(sync~spin) Heft: ${progressLabel(this.progress)}`;
    } else if (!this.index) {
      this.status.text = '$(layers) Heft';
    } else {
      const files = this.index.files.filter((f) => !f.ignoredByGit && fileInScope(this.scope, f.path));
      const size = files.reduce((s, f) => s + f.size, 0);
      this.status.text = `$(layers) Heft: ${label} · ${files.length} archivos · ${fmtSize(size)}`;
    }
    this.status.tooltip = 'Heft: elegir carpetas del ámbito';
    this.status.show();
  }

  /**
   * Texto sobre el árbol durante el primer análisis: en un repo grande el árbol tarda en
   * aparecer y la barra de progreso nativa sola no deja claro que Heft está trabajando.
   */
  private firstScanMessage(): string | undefined {
    if (!this.building || this.index?.complete) return undefined;
    const step = this.progress ? ` (${progressLabel(this.progress)})` : '';
    return this.index
      ? `Tamaños listos. Falta el uso y el historial de git${step}.`
      : `Analizando el repositorio${step}. En repos grandes puede tardar un poco.`;
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

  constructor(private readonly heft: Heft) {}

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
    const scope = this.heft.getScope();
    const item = new vscode.TreeItem(dir.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `d:${dir.path}`;
    item.resourceUri = this.heft.uriOf(dir);
    item.iconPath = vscode.ThemeIcon.Folder;
    item.contextValue = 'heftDir';
    item.description = `${fmtSize(dir.size)} · ${pct(share(dir.size, dir.parent?.size ?? 0))} · ${dir.count} arch.`;

    const covering = coveringFolder(scope, dir.path);
    const ancestor = coveredByAncestor(scope, dir.path);
    item.checkboxState = {
      state: covering ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked,
      tooltip: ancestor
        ? `En el ámbito por «${ancestor}/»`
        : covering
          ? 'Quitar del ámbito'
          : 'Añadir al ámbito',
    };
    // Las rutas van como texto: en Markdown `__tests__` se pintaría en negrita y `[id].tsx` como enlace.
    const md = new vscode.MarkdownString();
    md.appendText(`${dir.path}/`);
    md.appendMarkdown(`\n\n${fmtSize(dir.size)} · ${dir.count} archivos · ${pct(share(dir.size, dir.parent?.size ?? 0))} de la carpeta padre`);
    if (ancestor) {
      md.appendMarkdown('\n\nEn el ámbito porque lo está ');
      md.appendText(`«${ancestor}/»`);
    }
    item.tooltip = md;
    return item;
  }

  private fileItem(f: FileEntry, parent: DirNode): vscode.TreeItem {
    const uri = this.heft.uriOf({ kind: 'file', file: f, parent });
    const name = f.path.slice(f.path.lastIndexOf('/') + 1);
    const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
    item.id = `f:${f.path}`;
    item.resourceUri = uri;
    item.contextValue = 'heftFile';
    item.description = `${fmtSize(f.size)} · ${pct(share(f.size, parent.size))}${f.dirty ? ' ●' : ''}`;
    if (uri) item.command = { command: 'vscode.open', title: 'Abrir', arguments: [uri] };

    const md = new vscode.MarkdownString();
    md.appendText(f.path);
    md.appendMarkdown(`\n\n${fmtSize(f.size)}${f.lines != null ? ` · ${f.lines.toLocaleString('es-ES')} líneas` : ''}`);
    if (!this.heft.isComplete()) {
      // Primer análisis a medias: todavía no hay veredicto de uso ni datos de git.
      md.appendMarkdown('\n\nAnalizando uso y git…');
      item.tooltip = md;
      return item;
    }
    md.appendMarkdown(` · ${USAGE_LABEL[f.usage]}`);
    if (f.refsIn.length) md.appendMarkdown(` (${f.refsIn.length} ${f.refsIn.length === 1 ? 'archivo lo usa' : 'archivos lo usan'})`);
    if (f.lastCommit) {
      const c = f.lastCommit;
      md.appendMarkdown(`\n\nÚltimo commit: \`${c.short}\` ${escapeMd(c.subject)} — ${escapeMd(c.author)}, ${rel(c.time)}`);
      md.appendMarkdown(` · ${f.changes} ${f.changes === 1 ? 'cambio' : 'cambios'}`);
    } else if (f.untracked) {
      md.appendMarkdown('\n\nArchivo nuevo: todavía sin commits');
    }
    if (f.dirty && !f.untracked) md.appendMarkdown('\n\n● Cambios sin commit');
    item.tooltip = md;
    return item;
  }
}

function isTreeNode(x: unknown): x is TreeNode {
  return !!x && typeof x === 'object' && 'kind' in x && ((x as TreeNode).kind === 'dir' || (x as TreeNode).kind === 'file');
}

export { pct };

const PHASE_LABEL: Record<Progress['phase'], string> = {
  list: 'listando archivos',
  read: 'leyendo',
  git: 'historial de git',
  usage: 'uso',
  mentions: 'menciones',
};

/** «uso 1.200/3.006», o solo la fase si no se puede medir. */
export function progressLabel(p: Progress | undefined): string {
  if (!p) return 'analizando…';
  const n = (x: number): string => x.toLocaleString('es-ES');
  return p.total > 0 ? `${PHASE_LABEL[p.phase]} ${n(p.done)}/${n(p.total)}` : `${PHASE_LABEL[p.phase]}…`;
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
