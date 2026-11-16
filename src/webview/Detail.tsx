import { useEffect, useState } from 'react';
import type { I18n } from '../i18n/index.js';
import { USAGE_COLOR, usageLabel } from './colors.js';
import { useI18n } from './locale.js';
import type { Link, Row } from './model.js';
import { post } from './vscode.js';

/** Detalle del archivo seleccionado (SPEC §2.2): datos, acciones y quién lo usa. */
const MAX_LINKS = 200;


export function Detail(props: {
  row: Row | undefined;
  scopeBytes: number;
  links: { usedBy: Link[]; uses: Link[] };
  /** Clic en una referencia: seleccionarla si está en el ámbito; si no, abrirla. */
  onSelect(path: string, inScope: boolean): void;
}) {
  const { row, links } = props;
  const I = useI18n();
  if (!row) return <footer className="detail none">{I.t('detail.none')}</footer>;
  return (
    <footer className="detail">
      <div className="d-main">
        <span className="d-path" title={row.path}>
          {row.path}
        </span>
        <span className="d-meta">
          {I.size(row.size)} · {I.t('detail.ofScope', { pct: I.pct(props.scopeBytes > 0 ? row.size / props.scopeBytes : 0) })}
          {row.lines != null && ` · ${I.tp('lines', row.lines)}`}
          {row.changes > 0 && ` · ${I.tp('changes', row.changes)}`}
          {row.generated && ` · ${I.t('common.generated')}`}
        </span>
        <span className="d-actions">
          <button onClick={() => post({ type: 'open', path: row.path })}>{I.t('common.open')}</button>
          <button className="secondary" onClick={() => post({ type: 'reveal', path: row.path })}>
            {I.t('common.reveal')}
          </button>
        </span>
      </div>
      <div className="d-usage">
        <span className="d-state">
          <i className="dot" style={{ background: USAGE_COLOR[row.usage] }} />
          {usageLabel(row.usage, I)}
        </span>
        {row.usage !== 'referenced' && row.usage !== 'ignored-by-git' && <span className="d-hint">{I.t(`usageHint.${row.usage}`)}</span>}
        {row.usage === 'none' && (
          <span className="d-actions">
            <button className="secondary" title={I.t('detail.ignoreTip')} onClick={() => post({ type: 'ignoreUsage', path: row.path })}>
              {I.t('detail.ignore')}
            </button>
            <button className="secondary danger" onClick={() => post({ type: 'trash', path: row.path })}>
              {I.t('detail.trash')}
            </button>
          </span>
        )}
      </div>
      <Commit row={row} />
      {row.usage !== 'pending' && (links.usedBy.length > 0 || links.uses.length > 0) && (
        <div className="d-links">
          <Links I={I} title={I.t('detail.usedBy')} list={links.usedBy} onSelect={props.onSelect} />
          <Links I={I} title={I.t('detail.uses')} list={links.uses} onSelect={props.onSelect} />
        </div>
      )}
    </footer>
  );
}

function Links(props: { I: I18n; title: string; list: Link[]; onSelect(path: string, inScope: boolean): void }) {
  const { list, I } = props;
  return (
    <section className="links" aria-label={props.title}>
      <h2>
        {props.title} <span className="n">{list.length}</span>
      </h2>
      {list.length === 0 ? (
        <p className="nolinks">{I.t('detail.nothing')}</p>
      ) : (
        <ul>
          {list.slice(0, MAX_LINKS).map((l, i) => (
            <li key={`${l.path}:${l.kind}:${i}`}>
              <button className="link" title={I.t(l.inScope ? 'detail.select' : 'detail.outsideTip')} onClick={() => props.onSelect(l.path, l.inScope)}>
                {l.path}
              </button>
              <span className="kind">{I.t(`ref.${l.kind}`)}</span>
              {!l.inScope && <span className="outside">{I.t('detail.outside')}</span>}
            </li>
          ))}
          {list.length > MAX_LINKS && <li className="more">{I.t('detail.more', { n: I.num(list.length - MAX_LINKS) })}</li>}
        </ul>
      )}
    </section>
  );
}

/** Último commit del archivo (SPEC §2.2): hash (clic = copiar completo), mensaje, autor, fecha. */
function Commit({ row }: { row: Row }) {
  const I = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [row.path]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const c = row.commit;
  const diff = row.dirty && !row.untracked && (
    <button className="secondary" title={I.t('detail.diffTip')} onClick={() => post({ type: 'diff', path: row.path })}>
      {I.t('detail.diff')}
    </button>
  );
  if (row.untracked) {
    return (
      <div className="d-commit">
        <span className="new">{I.t('common.new')}</span>
        <span className="d-hint">{I.t('detail.newFile')}</span>
      </div>
    );
  }
  if (!c) return diff ? <div className="d-commit">{diff}</div> : null;
  return (
    <div className="d-commit">
      <button
        className="link hash"
        title={`${c.hash}\n${I.t('detail.copyHash')}`}
        onClick={() => {
          post({ type: 'copy', text: c.hash });
          setCopied(true);
        }}
      >
        {c.short}
      </button>
      {copied && <span className="copied">{I.t('detail.copied')}</span>}
      <span className="d-subject" title={c.subject}>
        {c.subject}
      </span>
      <span className="d-meta">
        {c.author} · {I.rel(c.time)} ({I.date(c.time)})
      </span>
      {row.dirty && <span className="dirty">{I.t('detail.uncommitted')}</span>}
      {diff}
    </div>
  );
}
