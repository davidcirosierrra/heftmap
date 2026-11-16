import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { HostMessage, PanelIndex, PanelStatus } from '../extension/panel-protocol.js';
import { fmtSize, pct } from '../report.js';
import { vscode } from './vscode.js';
import { DEFAULT_SORT, filterRows, nextSort, sortRows, toRows, totalSize, visibleRange, type Row, type Sort, type SortKey } from './model.js';

/** Fase 2 (SPEC §2.2): barra superior y tabla. El treemap y el detalle llegan en las fases 3 a 5. */

/** Lo que sobrevive a ocultar y volver a mostrar la pestaña. */
interface Saved {
  sort: Sort;
  filter: string;
  selected: string | null;
}

function loadSaved(): Saved {
  const s = vscode.getState() as Partial<Saved> | undefined;
  const keys: SortKey[] = ['name', 'folder', 'size'];
  const sort = s?.sort && keys.includes(s.sort.key) && (s.sort.dir === 'asc' || s.sort.dir === 'desc') ? s.sort : DEFAULT_SORT;
  return {
    sort,
    filter: typeof s?.filter === 'string' ? s.filter : '',
    selected: typeof s?.selected === 'string' ? s.selected : null,
  };
}

const ROW_HEIGHT = 24;
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'folder', label: 'Carpeta' },
  { key: 'size', label: 'Tamaño' },
];
const count = (n: number): string => `${n.toLocaleString('es-ES')} ${n === 1 ? 'archivo' : 'archivos'}`;

export function App() {
  // undefined: el panel aún no ha recibido nada de la extensión.
  const [index, setIndex] = useState<PanelIndex | null | undefined>(undefined);
  const [status, setStatus] = useState<PanelStatus | undefined>(undefined);
  const [saved, setSaved] = useState<Saved>(loadSaved);

  useEffect(() => {
    const onMessage = (e: MessageEvent<HostMessage>): void => {
      if (e.data.type === 'index') setIndex(e.data.index);
      else if (e.data.type === 'status') setStatus(e.data.status);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Con llaves: `setState` devuelve el estado y React tomaría ese valor por la función de
  // limpieza del efecto («destroy is not a function» al siguiente cambio: panel en blanco).
  useEffect(() => {
    vscode.setState(saved);
  }, [saved]);

  const scope = status?.scope ?? [];
  const scoped = useMemo(() => toRows(index?.files ?? [], scope), [index, scope.join('\n')]);
  const scopeBytes = useMemo(() => totalSize(scoped), [scoped]);
  const rows = useMemo(() => sortRows(filterRows(scoped, saved.filter), saved.sort), [scoped, saved.filter, saved.sort]);

  if (!status || index === undefined) return <Splash title="Cargando…" />;
  if (!status.hasRoot) return <Splash title="Abre una carpeta para ver qué pesa y qué se usa." idle />;
  if (!index) {
    if (status.error) {
      return (
        <Splash title="No se pudo analizar el repositorio" detail={status.error} idle>
          <button onClick={() => vscode.postMessage({ type: 'refresh' })}>Reintentar</button>
        </Splash>
      );
    }
    return (
      <Splash
        title="Analizando el repositorio…"
        detail={status.progress ?? undefined}
        fraction={status.fraction}
        hint="La tabla aparece en cuanto se conocen los tamaños. En repos grandes puede tardar un poco."
      />
    );
  }

  const filtered = saved.filter.trim() !== '';
  return (
    <div className="app">
      <header className="bar">
        <div className="chips">
          {scope.length === 0 ? (
            <span className="chip all">Todo el repositorio</span>
          ) : (
            scope.map((s) => (
              <span className="chip" key={s}>
                {s}/
                <button title={`Quitar «${s}/» del ámbito`} aria-label={`Quitar ${s} del ámbito`} onClick={() => vscode.postMessage({ type: 'removeScope', folder: s })}>
                  ✕
                </button>
              </span>
            ))
          )}
          <button className="link" onClick={() => vscode.postMessage({ type: 'pickScope' })}>
            Cambiar ámbito…
          </button>
        </div>
        <div className="totals">
          {filtered ? `${rows.length.toLocaleString('es-ES')} de ${count(scoped.length)} · ${fmtSize(totalSize(rows))}` : `${count(scoped.length)} · ${fmtSize(scopeBytes)}`}
        </div>
        <input
          className="filter"
          type="search"
          placeholder="Filtrar por nombre o ruta"
          aria-label="Filtrar por nombre o ruta"
          value={saved.filter}
          onChange={(e) => setSaved((s) => ({ ...s, filter: e.target.value }))}
        />
      </header>
      {status.building && (
        <div className="working" role="status">
          <span className="spinner small" />
          {index.complete ? 'Actualizando' : 'Tamaños listos. Falta el uso y el historial de git'}
          {status.progress ? `: ${status.progress}` : '…'}
        </div>
      )}
      {status.error && <div className="error">No se pudo analizar el repositorio: {status.error}</div>}
      <Table
        rows={rows}
        sort={saved.sort}
        scopeBytes={scopeBytes}
        selected={saved.selected}
        empty={filtered ? 'Ningún archivo coincide con el filtro.' : 'No hay archivos en el ámbito.'}
        onSort={(key) => setSaved((s) => ({ ...s, sort: nextSort(s.sort, key) }))}
        onSelect={(path) => setSaved((s) => ({ ...s, selected: path }))}
      />
    </div>
  );
}

function Splash(props: { title: string; detail?: string; hint?: string; fraction?: number | null; idle?: boolean; children?: React.ReactNode }) {
  return (
    <div className="splash" role="status">
      {!props.idle && <span className="spinner" />}
      <h1>{props.title}</h1>
      {props.detail && <p className="detail">{props.detail}</p>}
      {props.fraction != null && <progress value={props.fraction} max={1} />}
      {props.hint && <p className="hint">{props.hint}</p>}
      {props.children}
    </div>
  );
}

function Table(props: {
  rows: Row[];
  sort: Sort;
  scopeBytes: number;
  selected: string | null;
  empty: string;
  onSort(key: SortKey): void;
  onSelect(path: string): void;
}) {
  const { rows, selected } = props;
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

  const select = (i: number): void => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
    const el = body.current;
    if (!row || !el) return;
    props.onSelect(row.path);
    // Mantener la fila a la vista al moverse con el teclado.
    const top = rows.indexOf(row) * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  };

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
      select(moves[e.key] as number);
    } else if (e.key === 'Enter' && selected && selectedAt >= 0) {
      e.preventDefault();
      vscode.postMessage({ type: 'open', path: selected });
    }
  };

  const { start, end } = visibleRange(scrollTop, height, ROW_HEIGHT, rows.length);
  return (
    <div className="table" role="grid" aria-rowcount={rows.length}>
      <div className="row head" role="row">
        {COLUMNS.map((c) => {
          const active = props.sort.key === c.key;
          return (
            <button
              key={c.key}
              role="columnheader"
              className={`cell ${c.key}`}
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
            {rows.slice(start, end).map((r, i) => {
              const isSelected = r.path === selected;
              return (
                <div
                  key={r.path}
                  role="row"
                  aria-selected={isSelected}
                  className={`row${isSelected ? ' selected' : ''}`}
                  style={{ top: (start + i) * ROW_HEIGHT }}
                  title={r.path}
                  onClick={() => props.onSelect(r.path)}
                >
                  <span className="cell name">{r.name}</span>
                  <span className="cell folder">{r.folder}</span>
                  <span className="cell size">
                    {fmtSize(r.size)} <span className="share">{pct(props.scopeBytes > 0 ? r.size / props.scopeBytes : 0)}</span>
                  </span>
                  {isSelected && (
                    <button className="open" onClick={() => vscode.postMessage({ type: 'open', path: r.path })}>
                      Abrir
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <footer className="foot">Clic: seleccionar · ↑ ↓: moverse · Enter: abrir</footer>
    </div>
  );
}
