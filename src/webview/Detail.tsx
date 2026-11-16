import { fmtSize, pct } from '../report.js';
import type { Row } from './model.js';
import { post } from './vscode.js';

/** Detalle del archivo seleccionado (SPEC §2.2). */
export function Detail({ row, scopeBytes }: { row: Row | undefined; scopeBytes: number }) {
  if (!row) return <footer className="detail none">Selecciona un archivo en la tabla o en el treemap. Enter o doble clic en el treemap: abrir.</footer>;
  return (
    <footer className="detail">
      <div className="d-main">
        <span className="d-path" title={row.path}>
          {row.path}
        </span>
        <span className="d-meta">
          {fmtSize(row.size)} · {pct(scopeBytes > 0 ? row.size / scopeBytes : 0)} del ámbito
        </span>
        <span className="d-actions">
          <button onClick={() => post({ type: 'open', path: row.path })}>Abrir</button>
          <button className="secondary" onClick={() => post({ type: 'reveal', path: row.path })}>
            Revelar en el explorador
          </button>
        </span>
      </div>
    </footer>
  );
}
