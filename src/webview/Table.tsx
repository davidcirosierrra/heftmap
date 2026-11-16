import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { visibleRange, type Row, type Sort, type SortKey } from './model.js';

/** Tabla virtualizada (SPEC §2.2): una fila por archivo, altura de fila fija. */
export interface Column {
  key: SortKey;
  label: string;
  /** Ancho en la rejilla CSS: '2fr', '130px'… */
  width: string;
  align?: 'right';
  title?: string;
  render(row: Row): ReactNode;
}

const ROW_HEIGHT = 24;

export function Table(props: {
  rows: Row[];
  columns: Column[];
  sort: Sort;
  selected: string | null;
  empty: string;
  onSort(key: SortKey): void;
  onSelect(path: string): void;
  onOpen(path: string): void;
}) {
  const { rows, selected, columns } = props;
  const body = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedAt = useMemo(() => (selected ? rows.findIndex((r) => r.path === selected) : -1), [rows, selected]);

  // La selección puede venir del treemap o cambiar de sitio al ordenar: que quede a la vista.
  useEffect(() => {
    const el = body.current;
    if (!el || selectedAt < 0) return;
    const top = selectedAt * ROW_HEIGHT;
    if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - (el.clientHeight - ROW_HEIGHT) / 2);
    }
  }, [selectedAt]);

  const onKeyDown = (e: KeyboardEvent): void => {
    const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = {
      ArrowDown: selectedAt + 1,
      ArrowUp: selectedAt < 0 ? 0 : selectedAt - 1,
      PageDown: selectedAt + page,
      PageUp: selectedAt - page,
      Home: 0,
      End: rows.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      const row = rows[Math.max(0, Math.min(rows.length - 1, moves[e.key] as number))];
      if (row) props.onSelect(row.path);
    } else if (e.key === 'Enter' && selected && selectedAt >= 0) {
      e.preventDefault();
      props.onOpen(selected);
    }
  };

  const grid = { gridTemplateColumns: columns.map((c) => c.width).join(' ') };
  const { start, end } = visibleRange(scrollTop, height, ROW_HEIGHT, rows.length);
  return (
    <div className="table" role="grid" aria-rowcount={rows.length}>
      <div className="row head" role="row" style={grid}>
        {columns.map((c) => {
          const active = props.sort.key === c.key;
          return (
            <button
              key={c.key}
              role="columnheader"
              className={`cell ${c.key}${c.align === 'right' ? ' right' : ''}`}
              title={c.title}
              aria-sort={active ? (props.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              onClick={() => props.onSort(c.key)}
            >
              {c.label}
              <span className="arrow">{active ? (props.sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
            </button>
          );
        })}
      </div>
      <div className="body" ref={body} tabIndex={0} onKeyDown={onKeyDown} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {rows.length === 0 ? (
          <p className="empty">{props.empty}</p>
        ) : (
          <div className="spacer" style={{ height: rows.length * ROW_HEIGHT }}>
            {rows.slice(start, end).map((r, i) => (
              <div
                key={r.path}
                role="row"
                aria-selected={r.path === selected}
                className={`row${r.path === selected ? ' selected' : ''}`}
                style={{ ...grid, top: (start + i) * ROW_HEIGHT }}
                title={r.path}
                onClick={() => props.onSelect(r.path)}
              >
                {columns.map((c) => (
                  <span key={c.key} className={`cell ${c.key}${c.align === 'right' ? ' right' : ''}`}>
                    {c.render(r)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
