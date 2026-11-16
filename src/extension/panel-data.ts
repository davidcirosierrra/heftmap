import type { HeftIndex } from '../core/index.js';
import type { PanelCommit, PanelFile, PanelIndex, PanelRef } from './panel-protocol.js';

/** Del índice del núcleo a lo que viaja al panel. Pura, sin `vscode`. */
export function toPanelIndex(index: HeftIndex, rootName: string): PanelIndex {
  const kept = index.files.filter((f) => !f.ignoredByGit);
  const at = new Map(kept.map((f, i) => [f.path, i]));
  // Cada referencia una sola vez (desde su origen) y por posición: el grafo de un repo
  // grande son decenas de miles de aristas.
  const refs: PanelRef[] = [];
  kept.forEach((f, from) => {
    for (const r of f.refsOut) {
      const to = at.get(r.to);
      if (to !== undefined) refs.push([from, to, r.kind]);
    }
  });
  // Los commits también una sola vez: muchos archivos comparten el último.
  const commits: PanelCommit[] = [];
  const commitAt = new Map<string, number>();
  const files = kept.map((f) => {
    const out: PanelFile = { path: f.path, size: f.size, usage: f.usage };
    if (f.lastCommit) {
      let i = commitAt.get(f.lastCommit.hash);
      if (i === undefined) {
        i = commits.push(f.lastCommit) - 1;
        commitAt.set(f.lastCommit.hash, i);
      }
      out.commit = i;
    }
    if (f.dirty) out.dirty = true;
    if (f.untracked) out.untracked = true;
    return out;
  });
  return { rootName, complete: index.complete, isGit: index.isGit, files, refs, commits };
}
