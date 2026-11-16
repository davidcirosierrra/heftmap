import type { I18n } from '../i18n/index.js';
import { USAGE_COLOR, usageLabel, type Coloring } from './colors.js';
import type { Column } from './Table.js';

/** Columnas de la tabla del panel. `scopeBytes`: total del ámbito, para el % de cada archivo. */
export function tableColumns(I: I18n, coloring: Coloring, scopeBytes: number): Column[] {
  return [
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
}
