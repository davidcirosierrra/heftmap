import type { FileEntry, HeftIndex } from '../core/index.js';

/**
 * Árbol de carpetas para la vista «Carpetas» (SPEC §2.1): tamaño acumulado, nº de archivos
 * y % dentro de la carpeta padre. Siempre sobre el repo entero; el ámbito se marca con
 * casillas, no recorta el árbol. Lógica pura, sin `vscode`.
 */
export interface DirNode {
  kind: 'dir';
  path: string;
  name: string;
  size: number;
  count: number;
  parent: DirNode | null;
  dirs: Map<string, DirNode>;
  files: FileEntry[];
}

export type TreeNode = DirNode | { kind: 'file'; file: FileEntry; parent: DirNode };

export interface FolderTree {
  root: DirNode;
  byPath: Map<string, DirNode>;
}

export function buildFolderTree(index: Pick<HeftIndex, 'files'>): FolderTree {
  const root: DirNode = { kind: 'dir', path: '', name: '', size: 0, count: 0, parent: null, dirs: new Map(), files: [] };
  const byPath = new Map<string, DirNode>([['', root]]);
  for (const f of index.files) {
    if (f.ignoredByGit) continue;
    const parts = f.path.split('/');
    let node = root;
    node.size += f.size;
    node.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i] as string;
      let child = node.dirs.get(name);
      if (!child) {
        const path = parts.slice(0, i + 1).join('/');
        child = { kind: 'dir', path, name, size: 0, count: 0, parent: node, dirs: new Map(), files: [] };
        node.dirs.set(name, child);
        byPath.set(path, child);
      }
      child.size += f.size;
      child.count++;
      node = child;
    }
    node.files.push(f);
  }
  return { root, byPath };
}

/** Hijos de una carpeta, carpetas y archivos mezclados, de mayor a menor tamaño. */
export function childrenOf(dir: DirNode): TreeNode[] {
  const kids: TreeNode[] = [
    ...dir.dirs.values(),
    ...dir.files.map((file) => ({ kind: 'file' as const, file, parent: dir })),
  ];
  const size = (n: TreeNode): number => (n.kind === 'dir' ? n.size : n.file.size);
  const name = (n: TreeNode): string => (n.kind === 'dir' ? n.name : n.file.path);
  return kids.sort((a, b) => size(b) - size(a) || name(a).localeCompare(name(b), 'es', { sensitivity: 'base' }));
}

/** Todas las carpetas, en orden de recorrido (para el selector del ámbito). */
export function allFolders(tree: FolderTree): DirNode[] {
  const out: DirNode[] = [];
  const walk = (d: DirNode): void => {
    const dirs = [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    for (const c of dirs) {
      out.push(c);
      walk(c);
    }
  };
  walk(tree.root);
  return out;
}

export function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}
