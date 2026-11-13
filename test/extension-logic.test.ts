import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/core/index.js';
import {
  addFolders,
  coveredByAncestor,
  fileInScope,
  sanitizeScope,
  scopeLabel,
  toggleFolder,
} from '../src/extension/scope.js';
import { allFolders, buildFolderTree, childrenOf } from '../src/extension/tree-model.js';

describe('ámbito', () => {
  it('vacío = todo el repositorio', () => {
    expect(fileInScope([], 'src/a.ts')).toBe(true);
    expect(scopeLabel([])).toBe('Todo el repositorio');
  });

  it('marcar una carpeta incluye sus subcarpetas y absorbe las ya marcadas', () => {
    expect(addFolders(['src/game', 'public'], ['src'])).toEqual(['public', 'src']);
    expect(addFolders(['src'], ['src/game'])).toEqual(['src']);
    expect(fileInScope(['src'], 'src/game/Kart.ts')).toBe(true);
    expect(fileInScope(['src'], 'srcx/a.ts')).toBe(false);
  });

  it('desmarcar una subcarpeta cubierta por un ancestro se bloquea', () => {
    expect(coveredByAncestor(['src'], 'src/game')).toBe('src');
    expect(toggleFolder(['src'], 'src/game', false)).toEqual({ kind: 'blocked', by: 'src' });
    expect(toggleFolder(['src', 'public'], 'src', false)).toEqual({ kind: 'changed', scope: ['public'] });
    expect(toggleFolder([], 'src', true)).toEqual({ kind: 'changed', scope: ['src'] });
  });

  it('limpia lo guardado', () => {
    expect(sanitizeScope(['./src/', 'src/game', 3, null, 'public\\models'])).toEqual(['public/models', 'src']);
    expect(sanitizeScope('src')).toEqual([]);
  });
});

describe('árbol de carpetas', () => {
  const f = (path: string, size: number): FileEntry =>
    ({ path, size, ignoredByGit: false }) as FileEntry;
  const tree = buildFolderTree({
    files: [
      f('public/models/circuit.glb', 840),
      f('public/models/kart.glb', 410),
      f('public/audio/music.mp3', 530),
      f('src/game/Kart.ts', 24),
      f('src/main.tsx', 1),
      f('package-lock.json', 300),
      { ...f('node_modules', 99999), ignoredByGit: true },
    ],
  });

  it('acumula tamaño y nº de archivos por carpeta, sin ignorados', () => {
    expect(tree.root.size).toBe(840 + 410 + 530 + 24 + 1 + 300);
    expect(tree.byPath.get('public')).toMatchObject({ size: 1780, count: 3 });
    expect(tree.byPath.get('public/models')).toMatchObject({ size: 1250, count: 2 });
  });

  it('ordena hijos de mayor a menor, mezclando carpetas y archivos', () => {
    const names = childrenOf(tree.root).map((n) => (n.kind === 'dir' ? n.name + '/' : n.file.path));
    expect(names).toEqual(['public/', 'package-lock.json', 'src/']);
  });

  it('lista todas las carpetas en orden de recorrido', () => {
    expect(allFolders(tree).map((d) => d.path)).toEqual(['public', 'public/audio', 'public/models', 'src', 'src/game']);
  });
});
