import type { HeftIndex } from '../core/index.js';
import type { PanelIndex } from './panel-protocol.js';

/** Del índice del núcleo a lo que viaja al panel. Pura, sin `vscode`. */
export function toPanelIndex(index: HeftIndex, rootName: string): PanelIndex {
  return {
    rootName,
    complete: index.complete,
    files: index.files.filter((f) => !f.ignoredByGit).map((f) => ({ path: f.path, size: f.size })),
  };
}
