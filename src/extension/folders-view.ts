import * as vscode from 'vscode';
import type { FileEntry } from '../core/index.js';
import type { I18n } from '../i18n/index.js';
import { bar } from './bars.js';
import { decoratedUri } from './decorations.js';
import { guardSync, type HeftLog } from './log.js';
import { coveredByAncestor, coveringFolder, type Scope } from './scope.js';
import { childrenOf, share, type DirNode, type FolderTree, type TreeNode } from './tree-model.js';

/** Vista lateral «Carpetas» (SPEC §2.1): árbol con peso, % sobre la carpeta padre y casillas de ámbito. */

/** Lo que la vista necesita de la extensión. */
export interface FoldersHost {
  readonly I: I18n;
  getTree(): FolderTree | undefined;
  getScope(): Scope;
  isComplete(): boolean;
  uriOf(node: TreeNode): vscode.Uri | undefined;
}

export class FoldersProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly heft: FoldersHost, log: HeftLog) {
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
    item.resourceUri = decoratedUri(this.heft.uriOf(dir), share(dir.size, dir.parent?.size ?? 0));
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
    item.resourceUri = decoratedUri(uri, share(f.size, parent.size));
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

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
