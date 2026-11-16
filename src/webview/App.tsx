import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { HostMessage, PanelIndex, PanelStatus } from '../extension/panel-protocol.js';
import type { I18n, MessageKey } from '../i18n/index.js';
import { setLocale, useI18n } from './locale.js';
import { COLOR_LABEL, coloring as buildColoring } from './colors.js';
import { tableColumns } from './columns.js';
import { Detail } from './Detail.js';
import { QUICK_LABEL, filterRows, inZoom, zoomRows, hotspotRows, linksOf, nextSort, quickCounts, quickRows, sortRows, toRows, totalSize, type Quick } from './model.js';
import { SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, useSaved } from './saved.js';
import { useSplit } from './split.js';
import { Table } from './Table.js';
import { Treemap } from './Treemap.js';
import { AREA_LABEL, crumbs, effectiveZoom } from './treemap-layout.js';
import { post } from './vscode.js';

/** Panel «Heftmap» (SPEC §2.2): barra superior · tabla · treemap · detalle. */

export function App() {
  const I = useI18n();
  const count = (n: number): string => I.tp('files', n);
  // undefined: el panel aún no ha recibido nada de la extensión.
  const [index, setIndex] = useState<PanelIndex | null | undefined>(undefined);
  const [status, setStatus] = useState<PanelStatus | undefined>(undefined);
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent<HostMessage>): void => {
      if (e.data.type === 'index') setIndex(e.data.index);
      else if (e.data.type === 'status') {
        setLocale(e.data.status.locale);
        setStatus(e.data.status);
        applyDefaults(e.data.status.defaults);
      } else if (e.data.type === 'requestExport') exportRows();
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);
  // Después del efecto de mensajes, para que el orden de los efectos sea el de siempre.
  const [saved, set, setSaved, applyDefaults] = useSaved();

  const scope = status?.scope ?? [];
  const scoped = useMemo(() => toRows(index?.files ?? [], scope, { complete: index?.complete, refs: index?.refs, commits: index?.commits }), [index, scope.join('\n')]);
  const scopeBytes = useMemo(() => totalSize(scoped), [scoped]);
  const counts = useMemo(() => quickCounts(scoped), [scoped]);
  // Con el índice a medias no hay veredicto de uso: un filtro rápido guardado vaciaría la tabla.
  const quick: Quick = index?.complete ? saved.quick : 'all';
  // Hotspots (SPEC §3.5): área Líneas + color Cambios + tabla por Cambios, y solo código: sin
  // esto el ranking lo copaban package.json y los lockfiles. Necesita git.
  const canHotspots = !!index?.complete && index.isGit !== false;
  const inHotspots =
    canHotspots && saved.hot && saved.area === 'lines' && saved.color === 'changes' && saved.sort.key === 'changes' && saved.sort.dir === 'desc';
  const base = useMemo(() => (inHotspots ? hotspotRows(scoped) : scoped), [scoped, inHotspots]);
  const filtered = useMemo(() => filterRows(quickRows(base, quick), saved.filter), [base, quick, saved.filter]);
  const sorted = useMemo(() => sortRows(filtered, saved.sort), [filtered, saved.sort]);
  // Colores sobre el ámbito, no sobre el filtro: escribir en el filtro no debe cambiarlos.
  const coloring = useMemo(() => buildColoring(saved.color, base, I), [saved.color, base, I]);
  const zoom = useMemo(() => effectiveZoom(filtered, saved.zoom), [filtered, saved.zoom]);
  // La tabla y los totales enseñan lo mismo que el treemap: lo de dentro de la carpeta ampliada.
  const zoomed = useMemo(() => zoomRows(sorted, zoom), [sorted, zoom]);
  const selectedRow = useMemo(() => (saved.selected ? scoped.find((r) => r.path === saved.selected) : undefined), [scoped, saved.selected]);
  const links = useMemo(
    () => (index && selectedRow ? linksOf(index.files, index.refs ?? [], selectedRow.path, scope) : { usedBy: [], uses: [] }),
    [index, selectedRow, scope.join('\n')],
  );

  useEffect(() => {
    if (highlight != null && !coloring.legend.some((l) => l.key === highlight)) setHighlight(null);
  }, [coloring, highlight]);
  // Grupo de la leyenda pulsado: atenúa el resto en el treemap y recorta la tabla a ese grupo.
  const group = highlight != null ? coloring.legend.find((l) => l.key === highlight) : undefined;
  const rows = useMemo(() => (group ? zoomed.filter((r) => coloring.keyOf(r) === group.key) : zoomed), [zoomed, group, coloring]);
  // «Copiar tabla» (botón o comando): las filas que se ven, en su orden. Por ref, porque el
  // comando llega por el oyente de mensajes, que se registra una vez.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const exportRows = (): void => post({ type: 'exportTable', paths: rowsRef.current.map((r) => r.path) });

  // Teclado dentro del panel: «/» enfoca el filtro y Escape sale del zoom. No se toca nada
  // mientras se escribe en un campo (allí Escape es del propio campo).
  const filterInput = useRef<HTMLInputElement>(null);
  const zoomRef = useRef({ zoom, leave: () => set({ zoom: '' }) });
  zoomRef.current = { zoom, leave: () => set({ zoom: '' }) };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/' && filterInput.current) {
        filterInput.current.focus();
        filterInput.current.select();
        e.preventDefault();
      } else if (e.key === 'Escape' && zoomRef.current.zoom) {
        zoomRef.current.leave();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const split = useSplit(setSaved);

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

  const columns = tableColumns(I, coloring, scopeBytes);

  const isFiltered = saved.filter.trim() !== '' || quick !== 'all' || inHotspots || zoom !== '' || !!group;
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
        <button className="link export" title={I.t('export.buttonTip')} disabled={rows.length === 0} onClick={exportRows}>
          {I.t('export.button')}
        </button>
        <input
          ref={filterInput}
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
          onClick={() =>
            set(inHotspots ? { hot: false } : { hot: true, area: 'lines', color: 'changes', sort: { key: 'changes', dir: 'desc' }, zoom: '', chart: true })
          }
        >
          {I.t('bar.hotspots')}
        </button>
        <button className="pill" aria-pressed={saved.chart} title={I.t('bar.chartTip')} onClick={() => set({ chart: !saved.chart })}>
          {I.t(saved.chart ? 'bar.hideChart' : 'bar.showChart')}
        </button>
        {group && (
          <span className="chip group">
            <i className="swatch" style={{ background: group.color }} />
            {I.t('bar.group', { label: group.label })}
            <button title={I.t('bar.leaveGroup')} aria-label={I.t('bar.leaveGroup')} onClick={() => setHighlight(null)}>
              ✕
            </button>
          </span>
        )}
        {zoom && (
          <span className="chip zoom">
            {I.t('bar.zoom', { folder: zoom })}
            <button title={I.t('bar.leaveZoom')} aria-label={I.t('bar.leaveZoom')} onClick={() => set({ zoom: '' })}>
              ✕
            </button>
          </span>
        )}
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
      <div className={`main${saved.chart ? '' : ' no-chart'}`} ref={split.main} style={{ '--split': `${(saved.split * 100).toFixed(2)}%` } as CSSProperties}>
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
            onPointerDown={split.onPointerDown}
            onPointerMove={split.onPointerMove}
            onPointerUp={split.onPointerUp}
            onPointerCancel={split.onPointerUp}
            onDoubleClick={() => set({ split: SPLIT_DEFAULT })}
            onKeyDown={split.onKeyDown}
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
      <Detail row={selectedRow} scopeBytes={scopeBytes} links={links} onSelect={(path, inScope) => {
          // Un enlace a un archivo fuera de la carpeta ampliada sale del zoom: si no, la tabla no lo enseñaría.
          if (inScope) set(inZoom(path, zoom) ? { selected: path } : { selected: path, zoom: '' });
          else post({ type: 'open', path });
        }}
      />
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
