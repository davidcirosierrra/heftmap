import path from 'node:path';
import * as vscode from 'vscode';
import { buildIndex, type FileEntry, type HeftIndex } from '../core/index.js';
import { fmtMs, fmtSize, rel, USAGE_LABEL } from '../report.js';
import {
  addFolders,
  coveredByAncestor,
  coveringFolder,
  fileInScope,
  sanitizeScope,
  scopeLabel,
  toggleFolder,
  type Scope,
} from './scope.js';
import { allFolders, buildFolderTree, childrenOf, share, type DirNode, type FolderTree, type TreeNode } from './tree-model.js';

/**
 * Fase 1 (SPEC §5): vista lateral «Carpetas» con tamaños y casillas de ámbito, comandos,
 * menú contextual del explorador y barra de estado. El panel (tabla + treemap) llega en la fase 2.
 */

const VIEW_ID = 'heft.folders';
const SCOPE_KEY = 'heft.scope';
const REBUILD_DELAY_MS = 1500;

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Heft');
  const heft = new Heft(context, log);
  context.subscriptions.push(log, heft);
  void heft.start();
}

export function deactivate(): void {
  // Todo se libera con context.subscriptions.
}

class Heft implements vscode.Disposable {
  private root: vscode.Uri | undefined;
  private index: HeftIndex | undefined;
  private tree: FolderTree | undefined;
  private scope: string[];
  private building = false;
  private pending = false;
  private timer: NodeJS.Timeout | undefined;
  private error: string | undefined;

  private readonly provider: FoldersProvider;
  private readonly view: vscode.TreeView<TreeNode>;
  private readonly status: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
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

    this.disposables.push(
      this.view,
      this.status,
      this.view.onDidChangeCheckboxState((e) => this.onCheckboxes(e)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('heft')) this.schedule('ajustes');
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.start()),
    );
  }

  async start(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    this.root = folders[0]?.uri;
    if (!this.root) {
      this.index = undefined;
      this.tree = undefined;
      this.render();
      return;
    }
    if (folders.length > 1) {
      this.log.appendLine(`Workspace con ${folders.length} carpetas: Heft analiza solo la primera (${folders[0]?.name}).`);
    }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, '**/*'));
    const onFs = (uri: vscode.Uri): void => {
      // Dentro de .git solo interesa un cambio de HEAD o de ramas (nuevo commit).
      const p = uri.path;
      if (p.includes('/.git/') && !/\/\.git\/(HEAD|refs\/)/.test(p)) return;
      this.schedule('cambios en disco');
    };
    this.disposables.push(watcher, watcher.onDidCreate(onFs), watcher.onDidChange(onFs), watcher.onDidDelete(onFs));
    await this.rebuild('inicio');
  }

  // ---------------------------------------------------------------- datos

  getTree(): FolderTree | undefined {
    return this.tree;
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

  private async rebuild(reason: string): Promise<void> {
    if (!this.root) return;
    if (this.building) {
      this.pending = true;
      return;
    }
    this.building = true;
    this.render();
    try {
      const cfg = vscode.workspace.getConfiguration('heft', this.root);
      const index = await buildIndex(this.root.fsPath, {
        publicDir: cfg.get<string>('publicDir') || 'public',
        since: cfg.get<string>('git.since') || undefined,
        ignore: cfg.get<string[]>('usage.ignore') ?? [],
        entryPoints: cfg.get<string[]>('usage.entryPoints') ?? [],
      });
      this.index = index;
      this.tree = buildFolderTree(index);
      this.error = undefined;
      const t = index.timings;
      this.log.appendLine(
        `[${new Date().toLocaleTimeString('es-ES')}] Índice (${reason}): ${index.files.length} archivos, ` +
          `${index.commitsRead} commits · listado ${fmtMs(t.list)}, lectura ${fmtMs(t.read)}, git ${fmtMs(t.git)}, ` +
          `uso ${fmtMs(t.usage)}, total ${fmtMs(t.total)}`,
      );
      for (const w of index.warnings) this.log.appendLine(`  aviso: ${w}`);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.log.appendLine(`Error al construir el índice: ${this.error}`);
    } finally {
      this.building = false;
      this.render();
      if (this.pending) {
        this.pending = false;
        void this.rebuild('cambios durante el análisis');
      }
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
    return list
      .map((u) => path.relative(rootPath, u.fsPath).split(path.sep).join('/'))
      .filter((r) => r && !r.startsWith('..') && !path.isAbsolute(r));
  }

  // ---------------------------------------------------------------- pintado

  private render(): void {
    this.provider.refresh();
    const label = scopeLabel(this.scope);
    this.view.description = this.building ? `${label} · analizando…` : label;
    this.view.message = this.error ? `No se pudo analizar el repositorio: ${this.error}` : undefined;

    if (!this.root) {
      this.status.hide();
      return;
    }
    if (!this.index) {
      this.status.text = '$(sync~spin) Heft: analizando…';
    } else {
      const files = this.index.files.filter((f) => !f.ignoredByGit && fileInScope(this.scope, f.path));
      const size = files.reduce((s, f) => s + f.size, 0);
      this.status.text = `${this.building ? '$(sync~spin)' : '$(layers)'} Heft: ${label} · ${files.length} archivos · ${fmtSize(size)}`;
    }
    this.status.tooltip = 'Heft: elegir carpetas del ámbito';
    this.status.show();
  }

  dispose(): void {
    clearTimeout(this.timer);
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
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${dir.path}/**\n\n`);
    md.appendMarkdown(`${fmtSize(dir.size)} · ${dir.count} archivos · ${pct(share(dir.size, dir.parent?.size ?? 0))} de la carpeta padre`);
    if (ancestor) md.appendMarkdown(`\n\nEn el ámbito porque lo está \`${ancestor}/\``);
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
    md.appendMarkdown(`**${f.path}**\n\n`);
    md.appendMarkdown(`${fmtSize(f.size)}${f.lines != null ? ` · ${f.lines.toLocaleString('es-ES')} líneas` : ''}`);
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

function pct(x: number): string {
  if (x <= 0) return '0 %';
  if (x < 0.001) return '<0,1 %';
  return `${(x * 100).toFixed(x >= 0.995 ? 0 : 1).replace('.', ',')} %`;
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
