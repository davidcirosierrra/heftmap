import { useRef, type Dispatch, type KeyboardEvent, type PointerEvent, type RefObject, type SetStateAction } from 'react';
import { clampSplit, SPLIT_DEFAULT, type Saved } from './saved.js';

export interface Split {
  /** Contenedor de tabla y gráfico: el divisor mide contra su ancho. */
  main: RefObject<HTMLDivElement | null>;
  onPointerDown(e: PointerEvent<HTMLDivElement>): void;
  onPointerMove(e: PointerEvent<HTMLDivElement>): void;
  onPointerUp(e: PointerEvent<HTMLDivElement>): void;
  onKeyDown(e: KeyboardEvent): void;
}

/**
 * Divisor entre la tabla y el gráfico: se arrastra (con captura del puntero, para no perderlo
 * al pasar sobre el SVG) o se mueve con las flechas; Inicio lo devuelve a su sitio.
 */
export function useSplit(setSaved: Dispatch<SetStateAction<Saved>>): Split {
  const main = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const box = main.current?.getBoundingClientRect();
    if (!dragging.current || !box || box.width <= 0) return;
    const split = clampSplit((e.clientX - box.left) / box.width);
    setSaved((s) => ({ ...s, split }));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
    if (e.key === 'Home') setSaved((s) => ({ ...s, split: SPLIT_DEFAULT }));
    else if (step) setSaved((s) => ({ ...s, split: clampSplit(s.split + step) }));
    else return;
    e.preventDefault();
  };
  return { main, onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}
