import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { COLOR_LABEL, type ColorMode } from './colors.js';
import { DEFAULT_SORT, QUICK_LABEL, SORT_KEYS, type Quick, type Sort } from './model.js';
import { AREA_LABEL, type AreaMode } from './treemap-layout.js';
import { vscode } from './vscode.js';

/** Lo que sobrevive a ocultar y volver a mostrar la pestaña. */
export interface Saved {
  sort: Sort;
  filter: string;
  quick: Quick;
  selected: string | null;
  area: AreaMode;
  color: ColorMode;
  zoom: string;
  /** Parte del ancho para la tabla, entre SPLIT_MIN y SPLIT_MAX. */
  split: number;
  /** false: gráficos ocultos, la tabla ocupa todo. */
  chart: boolean;
  /** Modo hotspots pedido con su botón (solo código). Se sale al cambiar área, color u orden. */
  hot: boolean;
}

export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.85;
export const SPLIT_DEFAULT = 0.6;
export const clampSplit = (x: number): number => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, x));

function loadSaved(): Saved {
  const s = (vscode.getState() ?? {}) as Partial<Saved>;
  const sort = s.sort && SORT_KEYS.includes(s.sort.key) && (s.sort.dir === 'asc' || s.sort.dir === 'desc') ? s.sort : DEFAULT_SORT;
  return {
    sort,
    filter: typeof s.filter === 'string' ? s.filter : '',
    quick: s.quick && s.quick in QUICK_LABEL ? s.quick : 'all',
    selected: typeof s.selected === 'string' ? s.selected : null,
    area: s.area && s.area in AREA_LABEL ? s.area : 'bytes',
    color: s.color && s.color in COLOR_LABEL ? s.color : 'ext',
    zoom: typeof s.zoom === 'string' ? s.zoom : '',
    split: typeof s.split === 'number' && Number.isFinite(s.split) ? clampSplit(s.split) : SPLIT_DEFAULT,
    chart: s.chart !== false,
    hot: s.hot === true,
  };
}

/**
 * Estado guardado del panel (`vscode.setState`): sobrevive a ocultar la pestaña y a recargar la
 * ventana. Devuelve el estado, un `set` que mezcla un parche y el `setState` de React.
 */
export function useSaved(): [Saved, (patch: Partial<Saved>) => void, Dispatch<SetStateAction<Saved>>] {
  const [saved, setSaved] = useState<Saved>(loadSaved);
  // Con llaves: `setState` devuelve el estado y React tomaría ese valor por la función de
  // limpieza del efecto («destroy is not a function» al siguiente cambio: panel en blanco).
  useEffect(() => {
    vscode.setState(saved);
  }, [saved]);
  const set = (patch: Partial<Saved>): void => setSaved((s) => ({ ...s, ...patch }));
  return [saved, set, setSaved];
}
