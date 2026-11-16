import { useEffect, useState } from 'react';
import { fmtSize, pct, rel } from '../report.js';
import { USAGE_COLOR, usageLabel } from './colors.js';
import type { Link, Row } from './model.js';
import { post } from './vscode.js';

/** Detalle del archivo seleccionado (SPEC §2.2): datos, acciones y quién lo usa. */
const MAX_LINKS = 200;

const USAGE_HINT: Partial<Record<Row['usage'], string>> = {
  none: 'Ni ruta ni nombre en ningún archivo: candidato a borrar.',
  mentioned: 'Su nombre aparece en algún archivo, pero ninguna ruta se resolvió (p. ej. rutas montadas en ejecución).',
  'no-importers': 'Código sin importadores: aviso de baja confianza. Para código muerto, usa Knip.',
  entry: 'Se usa desde fuera del grafo: nunca cuenta como huérfano.',
  exception: 'Marcado en heft.usage.ignore: nunca cuenta como huérfano.',
  'not-analyzed': 'Configuración, documentación o lockfile: no se analiza su uso.',
  pending: 'El análisis de uso todavía no ha terminado.',
};

export function Detail(props: {
  row: Row | undefined;
  scopeBytes: number;
  links: { usedBy: Link[]; uses: Link[] };
  /** Clic en una referencia: seleccionarla si está en el ámbito; si no, abrirla. */
  onSelect(path: string, inScope: boolean): void;
}) {
  const { row, links } = props;
  if (!row) return <footer className="detail none">Selecciona un archivo en la tabla o en el treemap. Enter o doble clic en el treemap: abrir.</footer>;
  return (
    <footer className="detail">
      <div className="d-main">
        <span className="d-path" title={row.path}>
          {row.path}
        </span>
        <span className="d-meta">
          {fmtSize(row.size)} · {pct(props.scopeBytes > 0 ? row.size / props.scopeBytes : 0)} del ámbito
          {row.lines != null && ` · ${row.lines.toLocaleString('es-ES')} ${row.lines === 1 ? 'línea' : 'líneas'}`}
          {row.changes > 0 && ` · ${row.changes.toLocaleString('es-ES')} ${row.changes === 1 ? 'cambio' : 'cambios'}`}
          {row.generated && ' · generado'}
        </span>
        <span className="d-actions">
          <button onClick={() => post({ type: 'open', path: row.path })}>Abrir</button>
          <button className="secondary" onClick={() => post({ type: 'reveal', path: row.path })}>
            Revelar en el explorador
          </button>
        </span>
      </div>
      <div className="d-usage">
        <span className="d-state">
          <i className="dot" style={{ background: USAGE_COLOR[row.usage] }} />
          {usageLabel(row.usage)}
        </span>
        <span className="d-hint">{USAGE_HINT[row.usage]}</span>
        {row.usage === 'none' && (
          <span className="d-actions">
            <button className="secondary" title="Lo añade al ajuste heft.usage.ignore" onClick={() => post({ type: 'ignoreUsage', path: row.path })}>
              Ignorar este archivo
            </button>
            <button className="secondary danger" onClick={() => post({ type: 'trash', path: row.path })}>
              Mover a la papelera…
            </button>
          </span>
        )}
      </div>
      <Commit row={row} />
      {row.usage !== 'pending' && (links.usedBy.length > 0 || links.uses.length > 0) && (
        <div className="d-links">
          <Links title="Lo usan" list={links.usedBy} onSelect={props.onSelect} />
          <Links title="Usa" list={links.uses} onSelect={props.onSelect} />
        </div>
      )}
    </footer>
  );
}

function Links(props: { title: string; list: Link[]; onSelect(path: string, inScope: boolean): void }) {
  const { list } = props;
  return (
    <section className="links" aria-label={props.title}>
      <h2>
        {props.title} <span className="n">{list.length}</span>
      </h2>
      {list.length === 0 ? (
        <p className="nolinks">Nada.</p>
      ) : (
        <ul>
          {list.slice(0, MAX_LINKS).map((l, i) => (
            <li key={`${l.path}:${l.kind}:${i}`}>
              <button className="link" title={l.inScope ? 'Seleccionar' : 'Fuera del ámbito: abrir el archivo'} onClick={() => props.onSelect(l.path, l.inScope)}>
                {l.path}
              </button>
              <span className="kind">{l.kind}</span>
              {!l.inScope && <span className="outside">fuera del ámbito</span>}
            </li>
          ))}
          {list.length > MAX_LINKS && <li className="more">y {list.length - MAX_LINKS} más</li>}
        </ul>
      )}
    </section>
  );
}

/** Último commit del archivo (SPEC §2.2): hash (clic = copiar completo), mensaje, autor, fecha. */
function Commit({ row }: { row: Row }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [row.path]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const c = row.commit;
  const diff = row.dirty && !row.untracked && (
    <button className="secondary" title="Cambios del árbol de trabajo contra el último commit" onClick={() => post({ type: 'diff', path: row.path })}>
      Ver diff
    </button>
  );
  if (row.untracked) {
    return (
      <div className="d-commit">
        <span className="new">nuevo</span>
        <span className="d-hint">Archivo nuevo: todavía sin commits.</span>
      </div>
    );
  }
  if (!c) return diff ? <div className="d-commit">{diff}</div> : null;
  return (
    <div className="d-commit">
      <button
        className="link hash"
        title={`${c.hash}\nClic para copiar el hash completo`}
        onClick={() => {
          post({ type: 'copy', text: c.hash });
          setCopied(true);
        }}
      >
        {c.short}
      </button>
      {copied && <span className="copied">copiado</span>}
      <span className="d-subject" title={c.subject}>
        {c.subject}
      </span>
      <span className="d-meta">
        {c.author} · {rel(c.time)} ({new Date(c.time).toLocaleDateString('es-ES')})
      </span>
      {row.dirty && <span className="dirty">● cambios sin commit</span>}
      {diff}
    </div>
  );
}
