/**
 * Barra de peso en texto para la vista «Carpetas» (SPEC §2.1). El TreeView nativo no deja
 * dibujar, pero sí escribir: con los bloques de Unicode (▏▎▍▌▋▊▉█) cada celda tiene 8
 * pasos. Con 10 celdas, 80 pasos: algo más de un 1 % por paso. Lógica pura, sin `vscode`.
 */
const PARTIAL = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
export const BAR_CELLS = 10;

export function bar(fraction: number, cells = BAR_CELLS): string {
  if (!(fraction > 0)) return '';
  const eighths = Math.max(1, Math.round(Math.min(1, fraction) * cells * 8));
  return '█'.repeat(Math.floor(eighths / 8)) + PARTIAL[eighths % 8];
}

/** Tramo de color por peso dentro de la carpeta padre; null = sin color. */
export type WeightTier = 'heavy' | 'large' | 'notable';

export function weightTier(fraction: number): WeightTier | null {
  if (fraction >= 0.5) return 'heavy';
  if (fraction >= 0.2) return 'large';
  if (fraction >= 0.1) return 'notable';
  return null;
}
