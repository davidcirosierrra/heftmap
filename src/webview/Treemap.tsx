import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from './locale.js';
import { textOn, type Coloring } from './colors.js';
import type { Row } from './model.js';
import { fitText, HEADER_HEIGHT, layoutTreemap, type AreaMode } from './treemap-layout.js';

interface Size {
  width: number;
  height: number;
}

/** Actualización del tamaño a lo que mide `el`; si no ha cambiado, el mismo objeto (no repinta). */
const measured =
  (el: HTMLElement) =>
  (s: Size): Size =>
    s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight };

/** Treemap 2D (SPEC §2.2): pinta en SVG lo que calcula `treemap-layout.ts`. */
export function Treemap(props: {
  rows: Row[];
  coloring: Coloring;
  area: AreaMode;
  zoom: string;
  selected: string | null;
  /** Grupo de la leyenda resaltado; el resto se atenúa. */
  highlight: string | null;
  onSelect(path: string): void;
  onOpen(path: string): void;
  onZoom(folder: string): void;
  /** Cambia cuando el panel reparte el ancho de otra forma (divisor): hay que volver a medir. */
  layoutKey?: unknown;
}) {
  const { rows, coloring, selected, highlight, area } = props;
  const I = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (): void => setSize(measured(el));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Al mover el divisor se mide en el mismo pintado, sin esperar al ResizeObserver.
  useLayoutEffect(() => {
    const el = box.current;
    if (el) setSize(measured(el));
  }, [props.layoutKey]);

  const cells = useMemo(
    () => layoutTreemap(rows, { width: size.width, height: size.height, area: props.area, zoom: props.zoom }),
    [rows, size.width, size.height, props.area, props.zoom],
  );
  // Los rectángulos solo se vuelven a pintar si cambia el dibujo, no con cada selección
  // (moverse por la tabla con las flechas repintaría miles de nodos). Los manejadores van
  // por referencia para no invalidar el memo.
  const handlers = useRef(props);
  handlers.current = props;
  const drawn = useMemo(
    () =>
      cells.map((c) => {
        if (c.kind === 'dir') {
          if (!c.header) return null;
          const amount = area === 'lines' ? I.t('tm.linesShort', { n: I.num(c.lines) }) : I.size(c.size);
          const label = fitText(`${c.name}  ${amount}`, c.w - 8) || fitText(c.name, c.w - 8);
          return (
            <g key={`d:${c.path}`} className="tm-dir" onClick={() => handlers.current.onZoom(c.path)}>
              <title>{I.t('tm.dirTip', { path: c.path, size: I.size(c.size), lines: area === 'lines' ? ` · ${I.tp('lines', c.lines)}` : '', files: I.tp('files', c.count) })}</title>
              <rect x={c.x} y={c.y} width={c.w} height={HEADER_HEIGHT - 1} />
              <text x={c.x + 4} y={c.y + 13}>
                {label}
              </text>
            </g>
          );
        }
        const row = c.row as Row;
        const fill = coloring.colorOf(row);
        const dim = highlight != null && coloring.keyOf(row) !== highlight;
        const label = c.h >= 16 ? fitText(c.name, c.w - 6) : '';
        return (
          <g
            key={`f:${c.path}`}
            className={`tm-file${dim ? ' dim' : ''}`}
            onClick={() => handlers.current.onSelect(c.path)}
            onDoubleClick={() => handlers.current.onOpen(c.path)}
          >
            <title>{`${c.path} · ${I.size(c.size)}${row.lines != null ? ` · ${I.tp('lines', row.lines)}` : ''}${row.changes ? ` · ${I.tp('changes', row.changes)}` : ''}`}</title>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={fill} />
            {label && (
              <text x={c.x + 3} y={c.y + 12} fill={textOn(fill)}>
                {label}
              </text>
            )}
          </g>
        );
      }),
    [cells, coloring, highlight, area, I],
  );
  const picked = selected ? cells.find((c) => c.kind === 'file' && c.path === selected) : undefined;

  return (
    <div className="treemap" ref={box}>
      {cells.length === 0 ? (
        size.width > 0 && <p className="empty">{I.t(area === 'lines' ? 'tm.nothingLines' : 'tm.nothing')}</p>
      ) : (
        <svg width={size.width} height={size.height} role="img" aria-label={I.t('tm.aria')}>
          {drawn}
          {picked && <rect className="tm-selected" x={picked.x + 1} y={picked.y + 1} width={Math.max(0, picked.w - 2)} height={Math.max(0, picked.h - 2)} />}
        </svg>
      )}
    </div>
  );
}
