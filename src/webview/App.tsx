import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { HostMessage, PanelIndex, PanelStatus } from '../extension/panel-protocol.js';
import type { I18n, MessageKey } from '../i18n/index.js';
import { setLocale, useI18n } from './locale.js';
import { COLOR_LABEL, USAGE_COLOR, coloring as buildColoring, usageLabel, type ColorMode } from './colors.js';
import { Detail } from './Detail.js';
import { DEFAULT_SORT, QUICK_LABEL, SORT_KEYS, filterRows, linksOf, nextSort, quickCounts, quickRows, sortRows, toRows, totalSize, type Quick, type Sort } from './model.js';
import { Table, type Column } from './Table.js';
import { Treemap } from './Treemap.js';
import { AREA_LABEL, crumbs, effectiveZoom, type AreaMode } from './treemap-layout.js';
import { post, vscode } from './vscode.js';

/** Panel «Heft» (SPEC §2.2): barra superior · tabla · treemap · detalle. */

/** Lo que sobrevive a ocultar y volver a mostrar la pestaña. */
interface Saved {
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
}

const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.85;
const SPLIT_DEFAULT = 0.6;
const clampSplit = (x: number): number => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, x));

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
  };
}

export function App() {
  const I = useI18n();
  const count = (n: number): string => I.tp('files', n);
  // undefined: el panel aún no ha recibido nada de la extensión.
  const [index, setIndex] = useState<PanelIndex | null | undefined>(undefined);
  const [status, setStatus] = useState<PanelStatus | undefined>(undefined);
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [highlight, setHighlight] = useState<string | null>(null);
  const set = (patch: Partial<Saved>): void => setSaved((s) => ({ ...s, ...patch }));

  useEffect(() => {
    const onMessage = (e: MessageEvent<HostMessage>): void => {
      if (e.data.type === 'index') setIndex(e.data.index);
      else if (e.data.type === 'status') {
        setLocale(e.data.status.locale);
        setStatus(e.data.status);
      }
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
  const scoped = useMemo(() => toRows(index?.files ?? [], scope, { complete: index?.complete, refs: index?.refs, commits: index?.commits }), [index, scope.join('\n')]);
  const scopeBytes = useMemo(() => totalSize(scoped), [scoped]);
  const counts = useMemo(() => quickCounts(scoped), [scoped]);
  // Con el índice a medias no hay veredicto de uso: un filtro rápido guardado vaciaría la tabla.
  const quick: Quick = index?.complete ? saved.quick : 'all';
  const filtered = useMemo(() => filterRows(quickRows(scoped, quick), saved.filter), [scoped, quick, saved.filter]);
  const rows = useMemo(() => sortRows(filtered, saved.sort), [filtered, saved.sort]);
  // Colores sobre el ámbito, no sobre el filtro: escribir en el filtro no debe cambiarlos.
  const coloring = useMemo(() => buildColoring(saved.color, scoped, I), [saved.color, scoped, I]);
  const zoom = useMemo(() => effectiveZoom(filtered, saved.zoom), [filtered, saved.zoom]);
  const selectedRow = useMemo(() => (saved.selected ? scoped.find((r) => r.path === saved.selected) : undefined), [scoped, saved.selected]);
  const links = useMemo(
    () => (index && selectedRow ? linksOf(index.files, index.refs ?? [], selectedRow.path, scope) : { usedBy: [], uses: [] }),
    [index, selectedRow, scope.join('\n')],
  );

  useEffect(() => {
    if (highlight != null && !coloring.legend.some((l) => l.key === highlight)) setHighlight(null);
  }, [coloring, highlight]);

  // Divisor entre la tabla y el gráfico: se arrastra (con captura del puntero, para no perderlo
  // al pasar sobre el SVG) o se mueve con las flechas.
  const main = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const onSplitDown = (e: PointerEvent<HTMLDivElement>): void => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onSplitMove = (e: PointerEvent<HTMLDivElement>): void => {
    const box = main.current?.getBoundingClientRect();
    if (!dragging.current || !box || box.width <= 0) return;
    set({ split: clampSplit((e.clientX - box.left) / box.width) });
  };
  const onSplitUp = (e: PointerEvent<HTMLDivElement>): void => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onSplitKey = (e: KeyboardEvent): void => {
    const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
    if (e.key === 'Home') setSaved((s) => ({ ...s, split: SPLIT_DEFAULT }));
    else if (step) setSaved((s) => ({ ...s, split: clampSplit(s.split + step) }));
    else return;
    e.preventDefault();
  };

  if (!status || index === undefined) return <Splash title={I.t('panel.loading')} />;
  if (!status.hasRoot) return <Splash title={I.t('panel.noFolder')} idle />;
  if (!index) {
    if (status.error) {
      return (
        <Splash title={I.t('panel.analysisFailed')} detail={status.error} idle>
          <button onClick={() => post({ type: 'refresh' })}>{I.t('common.retry')}</button>
        </Splash>
      );
    }
    return (
      <Splash
        title={I.t('panel.analyzing')}
        detail={status.progress ?? undefined}
        fraction={status.fraction}
        hint={I.t('panel.analyzingHint')}
      />
    );
  }

  const columns: Column[] = [
    {
      key: 'name',
      label: I.t('col.name'),
      width: 'minmax(120px, 2fr)',
      render: (r) => (
        <>
          <i className="swatch" style={{ background: coloring.colorOf(r) }} />
          {r.name}
        </>
      ),
    },
    { key: 'folder', label: I.t('col.folder'), width: 'minmax(90px, 2fr)', render: (r) => r.folder },
    {
      key: 'size',
      label: I.t('col.size'),
      width: '122px',
      align: 'right',
      title: I.t('col.sizeTip'),
      render: (r) => (
        <>
          {I.size(r.size)} <span className="share">{I.pct(scopeBytes > 0 ? r.size / scopeBytes : 0)}</span>
        </>
      ),
    },
    {
      key: 'lines',
      label: I.t('col.lines'),
      width: '72px',
      align: 'right',
      title: I.t('col.linesTip'),
      render: (r) => (r.lines == null ? '' : I.num(r.lines)),
    },
    {
      key: 'changes',
      label: I.t('col.changes'),
      width: '88px',
      align: 'right',
      title: I.t('col.changesTip'),
      render: (r) => (r.usage === 'pending' ? '…' : r.changes > 0 ? <span className={r.generated ? 'share auto' : undefined}>{I.num(r.changes)}</span> : ''),
    },
    {
      key: 'usage',
      label: I.t('col.usage'),
      width: '170px',
      title: I.t('col.usageTip'),
      render: (r) => (
        <span title={r.usage === 'no-importers' ? I.t('usageHint.no-importers') : undefined}>
          <i className="dot" style={{ background: USAGE_COLOR[r.usage] }} />
          {usageLabel(r.usage, I)}
          {r.refsIn > 0 && <span className="share">{' '}· {r.refsIn}</span>}
        </span>
      ),
    },
    {
      key: 'changed',
      label: I.t('col.changed'),
      width: '166px',
      title: I.t('col.changedTip'),
      render: (r) =>
        r.untracked ? (
          <span className="new">{I.t('common.new')}</span>
        ) : r.commit ? (
          <span title={`${r.commit.short} ${r.commit.subject} — ${r.commit.author}`}>
            {I.rel(r.commit.time)} <span className="hash">{r.commit.short}</span>
            {r.dirty && <span className="dirty" title={I.t('common.uncommitted')}> ●</span>}
          </span>
        ) : (
          <span className="share">{r.usage === 'pending' ? '…' : '—'}</span>
        ),
    },
  ];

  const isFiltered = saved.filter.trim() !== '' || quick !== 'all';
  // Hotspots (SPEC §3.5): área Líneas + color Cambios + tabla por Cambios. Necesita git.
  const canHotspots = index.complete && index.isGit !== false;
  const inHotspots = saved.area === 'lines' && saved.color === 'changes' && saved.sort.key === 'changes' && saved.sort.dir === 'desc';
  return (
    <div className="app">
      <header className="bar">
        <div className="chips">
          {scope.length === 0 ? (
            <span className="chip all">{I.t('scope.all')}</span>
          ) : (
            scope.map((s) => (
              <span className="chip" key={s}>
                {s}/
                <button title={I.t('bar.removeScope', { folder: s })} aria-label={I.t('bar.removeScope', { folder: s })} onClick={() => post({ type: 'removeScope', folder: s })}>
                  ✕
                </button>
              </span>
            ))
          )}
          <button className="link" onClick={() => post({ type: 'pickScope' })}>
            {I.t('bar.changeScope')}
          </button>
        </div>
        <div className="totals">
          {isFiltered
            ? I.t('bar.filteredTotals', { shown: I.num(rows.length), files: count(scoped.length), size: I.size(totalSize(rows)) })
            : `${count(scoped.length)} · ${I.size(scopeBytes)}`}
        </div>
        <input
          className="filter"
          type="search"
          placeholder={I.t('bar.filter')}
          aria-label={I.t('bar.filter')}
          value={saved.filter}
          onChange={(e) => set({ filter: e.target.value })}
        />
      </header>
      <div className="quick" role="group" aria-label={I.t('bar.quickFilters')}>
        {(Object.keys(QUICK_LABEL) as Quick[]).map((q) => (
          <button
            key={q}
            className={`pill${quick === q ? ' on' : ''}`}
            aria-pressed={quick === q}
            disabled={(!index.complete && q !== 'all') || (q === 'dirty' && index.isGit === false)}
            onClick={() => set({ quick: q })}
          >
            {I.t(QUICK_LABEL[q])}
            {q !== 'all' && index.complete && <span className="n">{I.num(counts[q])}</span>}
          </button>
        ))}
        <button
          className={`pill hot${inHotspots ? ' on' : ''}`}
          aria-pressed={inHotspots}
          disabled={!canHotspots}
          title={I.t(canHotspots ? 'bar.hotspotsTip' : 'bar.hotspotsNoGit')}
          onClick={() => set({ area: 'lines', color: 'changes', sort: { key: 'changes', dir: 'desc' }, zoom: '', chart: true })}
        >
          {I.t('bar.hotspots')}
        </button>
        <button className="pill" aria-pressed={saved.chart} title={I.t('bar.chartTip')} onClick={() => set({ chart: !saved.chart })}>
          {I.t(saved.chart ? 'bar.hideChart' : 'bar.showChart')}
        </button>
      </div>
      {/* Siempre presente y de altura fija: si apareciera solo al analizar, la tabla saltaría. */}
      <div className={`statusline${!status.building && status.error ? ' failed' : ''}`} role="status">
        {status.building ? (
          <>
            <span className="spinner small" />
            <span className="txt">
              {I.t(index.complete ? 'panel.updating' : 'panel.sizesReady')}
              {status.progress ? `: ${status.progress}` : '…'}
            </span>
          </>
        ) : status.error ? (
          <span className="txt">{I.t('panel.errorLine', { error: status.error })}</span>
        ) : (
          <span className="txt">
            {I.t('panel.lastUpdate', { time: index.updatedAt ? I.time(index.updatedAt) : '—' })}
          </span>
        )}
      </div>
      <div className={`main${saved.chart ? '' : ' no-chart'}`} ref={main} style={{ '--split': `${(saved.split * 100).toFixed(2)}%` } as CSSProperties}>
        <Table
          rows={rows}
          columns={columns}
          sort={saved.sort}
          selected={saved.selected}
          empty={I.t(isFiltered ? 'table.noMatch' : 'table.empty')}
          onSort={(key) => setSaved((s) => ({ ...s, sort: nextSort(s.sort, key) }))}
          onSelect={(path) => set({ selected: path })}
          onOpen={(path) => post({ type: 'open', path })}
        />
        {saved.chart && (
          <div
            className="splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label={I.t('tm.splitter')}
            aria-valuemin={SPLIT_MIN * 100}
            aria-valuemax={SPLIT_MAX * 100}
            aria-valuenow={Math.round(saved.split * 100)}
            tabIndex={0}
            title={I.t('tm.splitterTip')}
            onPointerDown={onSplitDown}
            onPointerMove={onSplitMove}
            onPointerUp={onSplitUp}
            onPointerCancel={onSplitUp}
            onDoubleClick={() => set({ split: SPLIT_DEFAULT })}
            onKeyDown={onSplitKey}
          />
        )}
        {saved.chart && (
          <section className="tm-pane" aria-label="Treemap">
          <div className="tm-bar">
            <nav className="crumbs" aria-label={I.t('tm.zoomed')}>
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
            <Select I={I} label={I.t('tm.area')} value={saved.area} options={AREA_LABEL} onChange={(area) => set({ area })} />
            <Select
              I={I}
              label={I.t('tm.color')}
              value={saved.color}
              options={COLOR_LABEL}
              disabled={index.isGit === false ? ['age', 'recent', 'changes'] : []}
              onChange={(color) => set({ color })}
            />
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
            layoutKey={saved.split}
          />
          <div className="legend" aria-label={I.t('tm.legend', { mode: I.t(COLOR_LABEL[saved.color]) })}>
            {coloring.legend.map((l) => (
              <button
                key={l.key}
                className={`leg${highlight === l.key ? ' on' : ''}${highlight != null && highlight !== l.key ? ' off' : ''}`}
                title={I.t('tm.legendTip', { files: count(l.count), size: I.size(l.size) })}
                aria-pressed={highlight === l.key}
                onClick={() => setHighlight((h) => (h === l.key ? null : l.key))}
              >
                <i className="swatch" style={{ background: l.color }} />
                {l.label}
              </button>
            ))}
          </div>
        </section>
        )}
      </div>
      <Detail row={selectedRow} scopeBytes={scopeBytes} links={links} onSelect={(path, inScope) => (inScope ? set({ selected: path }) : post({ type: 'open', path }))} />
    </div>
  );
}

function Select<T extends string>(props: { I: I18n; label: string; value: T; options: Record<T, MessageKey>; disabled?: T[]; onChange(v: T): void }) {
  const keys = Object.keys(props.options) as T[];
  return (
    <label className="select">
      {props.label}
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)} disabled={keys.length < 2}>
        {keys.map((k) => (
          <option key={k} value={k} disabled={props.disabled?.includes(k)}>
            {props.I.t(props.options[k])}
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
