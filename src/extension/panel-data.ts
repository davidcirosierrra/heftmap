import type { HeftIndex } from '../core/index.js';
import type { PanelIndex, PanelRef } from './panel-protocol.js';

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
  return {
    rootName,
    complete: index.complete,
    files: kept.map((f) => ({ path: f.path, size: f.size, usage: f.usage })),
    refs,
  };
}
