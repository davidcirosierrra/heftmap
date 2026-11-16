import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { currentI18n, useI18n } from './locale.js';
import { post } from './vscode.js';

/**
 * Errores del panel a la vista. Sin esto, un fallo al pintar deja la pestaña en blanco
 * (React desmonta todo) y uno en un manejador pasa desapercibido. Los dos se mandan además
 * al registro de Heft (*Output → Heft*).
 */
export interface PanelError {
  message: string;
  stack?: string;
}

function describe(err: unknown): PanelError {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack };
  return { message: typeof err === 'string' ? err : JSON.stringify(err) ?? String(err) };
}

function report(where: string, e: PanelError, extra?: string): void {
  post({ type: 'error', where, message: e.message, stack: [e.stack, extra].filter(Boolean).join('\n') || undefined });
}

function ErrorDetails({ error, extra }: { error: PanelError; extra?: string }) {
  // Sin hook: también se pinta desde el límite de errores, que es una clase.
  const I = currentI18n();
  const text = [error.message, error.stack, extra].filter(Boolean).join('\n');
  return (
    <>
      <pre className="stack">{text}</pre>
      <div className="actions">
        <button onClick={() => post({ type: 'copy', text })}>{I.t('crash.copy')}</button>
        <button className="secondary" onClick={() => post({ type: 'showLog' })}>
          {I.t('crash.log')}
        </button>
      </div>
    </>
  );
}

interface BoundaryState {
  error: PanelError | null;
  components?: string;
}

/** Fallo al pintar: se enseña el error con su traza en vez de una pestaña en blanco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(err: unknown): BoundaryState {
    return { error: describe(err) };
  }

  override componentDidCatch(err: unknown, info: ErrorInfo): void {
    const components = info.componentStack ?? undefined;
    this.setState({ components });
    report(currentI18n().t('where.render'), describe(err), components);
  }

  override render(): ReactNode {
    const { error, components } = this.state;
    if (!error) return this.props.children;
    const I = currentI18n();
    return (
      <div className="crash" role="alert">
        <h1>{I.t('crash.title')}</h1>
        <p>{I.t('crash.body')}</p>
        <div className="actions">
          <button onClick={() => this.setState({ error: null, components: undefined })}>{I.t('common.retry')}</button>
        </div>
        <ErrorDetails error={error} extra={components} />
      </div>
    );
  }
}

/** Errores fuera del pintado (manejadores, promesas): banda descartable sobre el panel. */
export function RuntimeErrors() {
  const I = useI18n();
  const [errors, setErrors] = useState<PanelError[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const add = (where: string, err: unknown): void => {
      const e = describe(err);
      report(where, e);
      setErrors((list) => [...list.slice(-4), e]);
    };
    const onError = (ev: ErrorEvent): void => add(currentI18n().t('where.runtime'), ev.error ?? ev.message);
    const onRejection = (ev: PromiseRejectionEvent): void => add(currentI18n().t('where.promise'), ev.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const last = errors.at(-1);
  if (!last) return null;
  return (
    <div className="runtime-error" role="alert">
      <div className="line">
        <span className="msg">
          {errors.length > 1 ? I.t('runtime.many', { n: I.num(errors.length) }) : I.t('runtime.single')}
          {last.message}
        </span>
        <button className="link" onClick={() => setOpen((o) => !o)}>
          {I.t(open ? 'runtime.hide' : 'runtime.details')}
        </button>
        <button
          className="link"
          onClick={() => {
            setErrors([]);
            setOpen(false);
          }}
        >
          {I.t('runtime.dismiss')}
        </button>
      </div>
      {open && <ErrorDetails error={last} />}
    </div>
  );
}
