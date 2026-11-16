import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmtSize } from '../report.js';
import { textOn, type Coloring } from './colors.js';
import type { Row } from './model.js';
import { fitText, HEADER_HEIGHT, layoutTreemap, type AreaMode } from './treemap-layout.js';

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
}) {
  const { rows, coloring, selected, highlight } = props;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (): void =>
      setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
          const label = fitText(`${c.name}  ${fmtSize(c.size)}`, c.w - 8) || fitText(c.name, c.w - 8);
          return (
            <g key={`d:${c.path}`} className="tm-dir" onClick={() => handlers.current.onZoom(c.path)}>
              <title>{`${c.path}/ · ${fmtSize(c.size)} · ${c.count} archivos. Clic para ampliar`}</title>
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
            <title>{`${c.path} · ${fmtSize(c.size)}`}</title>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={fill} />
            {label && (
              <text x={c.x + 3} y={c.y + 12} fill={textOn(fill)}>
                {label}
              </text>
            )}
          </g>
        );
      }),
    [cells, coloring, highlight],
  );
  const picked = selected ? cells.find((c) => c.kind === 'file' && c.path === selected) : undefined;

  return (
    <div className="treemap" ref={box}>
      {cells.length === 0 ? (
        size.width > 0 && <p className="empty">Nada que dibujar con este ámbito y filtro.</p>
      ) : (
        <svg width={size.width} height={size.height} role="img" aria-label="Treemap de archivos por tamaño">
          {drawn}
          {picked && <rect className="tm-selected" x={picked.x + 1} y={picked.y + 1} width={Math.max(0, picked.w - 2)} height={Math.max(0, picked.h - 2)} />}
        </svg>
      )}
    </div>
  );
}
