import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HostMessage, PanelIndex, PanelStatus } from '../extension/panel-protocol.js';
import { fmtSize, pct } from '../report.js';
import { COLOR_LABEL, coloring as buildColoring, type ColorMode } from './colors.js';
import { Detail } from './Detail.js';
import { DEFAULT_SORT, SORT_KEYS, filterRows, nextSort, sortRows, toRows, totalSize, type Sort } from './model.js';
import { Table, type Column } from './Table.js';
import { Treemap } from './Treemap.js';
import { AREA_LABEL, crumbs, effectiveZoom, type AreaMode } from './treemap-layout.js';
import { post, vscode } from './vscode.js';

/** Panel «Heft» (SPEC §2.2): barra superior · tabla · treemap · detalle. */

/** Lo que sobrevive a ocultar y volver a mostrar la pestaña. */
interface Saved {
  sort: Sort;
  filter: string;
  selected: string | null;
  area: AreaMode;
  color: ColorMode;
  zoom: string;
}

function loadSaved(): Saved {
  const s = (vscode.getState() ?? {}) as Partial<Saved>;
  const sort = s.sort && SORT_KEYS.includes(s.sort.key) && (s.sort.dir === 'asc' || s.sort.dir === 'desc') ? s.sort : DEFAULT_SORT;
  return {
    sort,
    filter: typeof s.filter === 'string' ? s.filter : '',
    selected: typeof s.selected === 'string' ? s.selected : null,
    area: s.area && s.area in AREA_LABEL ? s.area : 'bytes',
    color: s.color && s.color in COLOR_LABEL ? s.color : 'ext',
    zoom: typeof s.zoom === 'string' ? s.zoom : '',
  };
}

const count = (n: number): string => `${n.toLocaleString('es-ES')} ${n === 1 ? 'archivo' : 'archivos'}`;

export function App() {
  // undefined: el panel aún no ha recibido nada de la extensión.
  const [index, setIndex] = useState<PanelIndex | null | undefined>(undefined);
  const [status, setStatus] = useState<PanelStatus | undefined>(undefined);
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [highlight, setHighlight] = useState<string | null>(null);
  const set = (patch: Partial<Saved>): void => setSaved((s) => ({ ...s, ...patch }));

  useEffect(() => {
    const onMessage = (e: MessageEvent<HostMessage>): void => {
      if (e.data.type === 'index') setIndex(e.data.index);
      else if (e.data.type === 'status') setStatus(e.data.status);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
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
  const filtered = useMemo(() => filterRows(scoped, saved.filter), [scoped, saved.filter]);
  const rows = useMemo(() => sortRows(filtered, saved.sort), [filtered, saved.sort]);
  // Colores sobre el ámbito, no sobre el filtro: escribir en el filtro no debe cambiarlos.
  const coloring = useMemo(() => buildColoring(saved.color, scoped), [saved.color, scoped]);
  const zoom = useMemo(() => effectiveZoom(filtered, saved.zoom), [filtered, saved.zoom]);
  const selectedRow = useMemo(() => (saved.selected ? scoped.find((r) => r.path === saved.selected) : undefined), [scoped, saved.selected]);

  useEffect(() => {
    if (highlight != null && !coloring.legend.some((l) => l.key === highlight)) setHighlight(null);
  }, [coloring, highlight]);

  if (!status || index === undefined) return <Splash title="Cargando…" />;
  if (!status.hasRoot) return <Splash title="Abre una carpeta para ver qué pesa y qué se usa." idle />;
  if (!index) {
    if (status.error) {
      return (
        <Splash title="No se pudo analizar el repositorio" detail={status.error} idle>
          <button onClick={() => post({ type: 'refresh' })}>Reintentar</button>
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

  const columns: Column[] = [
    {
      key: 'name',
      label: 'Nombre',
      width: 'minmax(120px, 2fr)',
      render: (r) => (
        <>
          <i className="swatch" style={{ background: coloring.colorOf(r) }} />
          {r.name}
        </>
      ),
    },
    { key: 'folder', label: 'Carpeta', width: 'minmax(80px, 2fr)', render: (r) => r.folder },
    {
      key: 'size',
      label: 'Tamaño',
      width: '130px',
      align: 'right',
      title: 'Tamaño y % del ámbito',
      render: (r) => (
        <>
          {fmtSize(r.size)} <span className="share">{pct(scopeBytes > 0 ? r.size / scopeBytes : 0)}</span>
        </>
      ),
    },
  ];

  const isFiltered = saved.filter.trim() !== '';
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
                <button title={`Quitar «${s}/» del ámbito`} aria-label={`Quitar ${s} del ámbito`} onClick={() => post({ type: 'removeScope', folder: s })}>
                  ✕
                </button>
              </span>
            ))
          )}
          <button className="link" onClick={() => post({ type: 'pickScope' })}>
            Cambiar ámbito…
          </button>
        </div>
        <div className="totals">
          {isFiltered ? `${rows.length.toLocaleString('es-ES')} de ${count(scoped.length)} · ${fmtSize(totalSize(rows))}` : `${count(scoped.length)} · ${fmtSize(scopeBytes)}`}
        </div>
        <input
          className="filter"
          type="search"
          placeholder="Filtrar por nombre o ruta"
          aria-label="Filtrar por nombre o ruta"
          value={saved.filter}
          onChange={(e) => set({ filter: e.target.value })}
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
      <div className="main">
        <Table
          rows={rows}
          columns={columns}
          sort={saved.sort}
          selected={saved.selected}
          empty={isFiltered ? 'Ningún archivo coincide con el filtro.' : 'No hay archivos en el ámbito.'}
          onSort={(key) => setSaved((s) => ({ ...s, sort: nextSort(s.sort, key) }))}
          onSelect={(path) => set({ selected: path })}
          onOpen={(path) => post({ type: 'open', path })}
        />
        <section className="tm-pane" aria-label="Treemap">
          <div className="tm-bar">
            <nav className="crumbs" aria-label="Carpeta ampliada">
              {crumbs(zoom, index.rootName).map((c, i, all) =>
                i === all.length - 1 ? (
                  <span key={c.path} className="here">
                    {c.name}
                  </span>
                ) : (
                  <span key={c.path}>
                    <button className="link" onClick={() => set({ zoom: c.path })}>
                      {c.name}
                    </button>
                    <span className="sep">›</span>
                  </span>
                ),
              )}
            </nav>
            <Select label="Área" value={saved.area} options={AREA_LABEL} onChange={(area) => set({ area })} />
            <Select label="Color" value={saved.color} options={COLOR_LABEL} onChange={(color) => set({ color })} />
          </div>
          <Treemap
            rows={filtered}
            coloring={coloring}
            area={saved.area}
            zoom={zoom}
            selected={saved.selected}
            highlight={highlight}
            onSelect={(path) => set({ selected: path })}
            onOpen={(path) => post({ type: 'open', path })}
            onZoom={(folder) => set({ zoom: folder })}
          />
          <div className="legend" aria-label={`Leyenda: ${COLOR_LABEL[saved.color]}`}>
            {coloring.legend.map((l) => (
              <button
                key={l.key}
                className={`leg${highlight === l.key ? ' on' : ''}${highlight != null && highlight !== l.key ? ' off' : ''}`}
                title={`${count(l.count)} · ${fmtSize(l.size)}. Clic para resaltar`}
                aria-pressed={highlight === l.key}
                onClick={() => setHighlight((h) => (h === l.key ? null : l.key))}
              >
                <i className="swatch" style={{ background: l.color }} />
                {l.label}
              </button>
            ))}
          </div>
        </section>
      </div>
      <Detail row={selectedRow} scopeBytes={scopeBytes} />
    </div>
  );
}

function Select<T extends string>(props: { label: string; value: T; options: Record<T, string>; onChange(v: T): void }) {
  const keys = Object.keys(props.options) as T[];
  return (
    <label className="select">
      {props.label}
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)} disabled={keys.length < 2}>
        {keys.map((k) => (
          <option key={k} value={k}>
            {props.options[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

function Splash(props: { title: string; detail?: string; hint?: string; fraction?: number | null; idle?: boolean; children?: ReactNode }) {
  return (
    <div className="splash" role="status">
      {!props.idle && <span className="spinner" />}
      <h1>{props.title}</h1>
      {props.detail && <p className="detail-line">{props.detail}</p>}
      {props.fraction != null && <progress value={props.fraction} max={1} />}
      {props.hint && <p className="hint">{props.hint}</p>}
      {props.children}
    </div>
  );
}
