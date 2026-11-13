/**
 * Ámbito (SPEC §3.1): lista de carpetas, sin anidar (si está `src`, no está `src/game`).
 * Vacío = todo el repositorio. Solo filtra lo que se muestra; los cálculos son siempre
 * sobre el repo entero. Lógica pura, sin `vscode`, para poder probarla.
 */
export type Scope = readonly string[];

/** La carpeta está en el ámbito por sí misma o por un ancestro. */
export function coveringFolder(scope: Scope, folder: string): string | undefined {
  return scope.find((s) => folder === s || folder.startsWith(s + '/'));
}

/** Un ancestro (no ella misma) ya mete la carpeta en el ámbito. */
export function coveredByAncestor(scope: Scope, folder: string): string | undefined {
  return scope.find((s) => folder.startsWith(s + '/'));
}

export function fileInScope(scope: Scope, file: string): boolean {
  return scope.length === 0 || scope.some((s) => file.startsWith(s + '/'));
}

/** Añade carpetas y quita las que pasan a estar cubiertas por otra. */
export function addFolders(scope: Scope, folders: string[]): string[] {
  let next = [...scope];
  for (const f of folders.map(normalize).filter(Boolean)) {
    if (coveringFolder(next, f)) continue;
    next = next.filter((s) => !s.startsWith(f + '/'));
    next.push(f);
  }
  return next.sort();
}

export function removeFolder(scope: Scope, folder: string): string[] {
  return scope.filter((s) => s !== normalize(folder));
}

export type ToggleResult =
  | { kind: 'changed'; scope: string[] }
  /** No se puede quitar: la cubre un ancestro. La UI lo explica y repinta la casilla. */
  | { kind: 'blocked'; by: string };

/** Marcar o desmarcar la casilla de una carpeta. */
export function toggleFolder(scope: Scope, folder: string, checked: boolean): ToggleResult {
  const f = normalize(folder);
  if (checked) return { kind: 'changed', scope: addFolders(scope, [f]) };
  const ancestor = coveredByAncestor(scope, f);
  if (ancestor) return { kind: 'blocked', by: ancestor };
  return { kind: 'changed', scope: removeFolder(scope, f) };
}

export function scopeLabel(scope: Scope): string {
  return scope.length === 0 ? 'Todo el repositorio' : scope.join(' + ');
}

/** Lee lo guardado en workspaceState, descartando valores raros. */
export function sanitizeScope(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return addFolders([], value.filter((v): v is string => typeof v === 'string'));
}

function normalize(folder: string): string {
  return folder.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
}
