import * as vscode from 'vscode';
import type { I18n } from '../i18n/index.js';

/**
 * Registro de Heftmap (*Output → Heftmap*). Canal de tipo log: cada línea lleva fecha y nivel, se
 * guarda en los archivos de log de VS Code y respeta *Developer: Set Log Level*.
 *
 * Los errores llevan dónde pasaron y la traza, y avisan una vez (como mucho cada minuto) con
 * botones para abrir el registro o copiar un informe: así se sabe que es Heftmap la que falla y se
 * puede abrir una incidencia con lo necesario.
 */
const NOTIFY_EVERY_MS = 60_000;
const KEEP_LINES = 300;

export class HeftLog implements vscode.Disposable {
  private readonly channel: vscode.LogOutputChannel;
  /** Últimas líneas, para el informe (el canal no deja leerlas). */
  private readonly recent: string[] = [];
  private lastNotice = 0;
  private header = '';
  errors = 0;

  constructor(private readonly i18n: () => I18n) {
    this.channel = vscode.window.createOutputChannel('Heftmap', { log: true });
  }

  /** Versión, editor, sistema e idioma: lo primero que hace falta para entender un fallo. */
  start(version: string, extra: Record<string, string | boolean>): void {
    const info = {
      heftmap: version,
      vscode: vscode.version,
      app: vscode.env.appName,
      platform: `${process.platform} ${process.arch}`,
      node: process.versions.node,
      ...extra,
    };
    this.header = Object.entries(info)
      .map(([k, v]) => `${k}=${v}`)
      .join(' · ');
    this.info(`Heftmap ${version} · ${this.header}`);
  }

  info(message: string): void {
    this.channel.info(message);
    this.keep('info', message);
  }

  warn(message: string): void {
    this.channel.warn(message);
    this.keep('warn', message);
  }

  /**
   * Error con su traza. `notify`: además, aviso en pantalla (fallos inesperados; los que ya se
   * enseñan en la vista o en el panel no lo necesitan).
   */
  error(where: string, err: unknown, opts: { notify?: boolean; detail?: string } = {}): void {
    this.errors++;
    const message = errorMessage(err);
    const stack = err instanceof Error && err.stack ? err.stack : undefined;
    const text = [`[${where}] ${message}`, opts.detail, stack && !stack.includes(message) ? stack : stack?.split('\n').slice(1).join('\n')]
      .filter(Boolean)
      .join('\n');
    this.channel.error(text);
    this.keep('error', text);
    if (opts.notify) this.notify(where, message);
  }

  show(): void {
    this.channel.show(true);
  }

  /** Texto para pegar en una incidencia: cabecera y últimas líneas del registro. */
  report(): string {
    return ['Heftmap — error report', this.header, '', ...this.recent].join('\n');
  }

  private keep(level: string, text: string): void {
    for (const line of `${new Date().toISOString()} [${level}] ${text}`.split('\n')) this.recent.push(line);
    if (this.recent.length > KEEP_LINES) this.recent.splice(0, this.recent.length - KEEP_LINES);
  }

  private notify(where: string, message: string): void {
    const now = Date.now();
    if (now - this.lastNotice < NOTIFY_EVERY_MS) return;
    this.lastNotice = now;
    const I = this.i18n();
    const showLog = I.t('crash.log');
    const copy = I.t('error.copyReport');
    const ask = async (): Promise<void> => {
      const choice = await vscode.window.showErrorMessage(I.t('error.notify', { where, message }), showLog, copy);
      if (choice === showLog) this.show();
      else if (choice === copy) {
        await vscode.env.clipboard.writeText(this.report());
        void vscode.window.showInformationMessage(I.t('error.reportCopied'));
      }
    };
    void ask();
  }

  dispose(): void {
    this.channel.dispose();
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/**
 * Envuelve un manejador (comando, evento, mensaje del panel) para que un fallo, síncrono o
 * asíncrono, quede en el registro con su origen en vez de perderse en el log del editor.
 */
export function guard<A extends unknown[]>(log: HeftLog, where: string, fn: (...args: A) => unknown): (...args: A) => Promise<unknown> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      log.error(where, err, { notify: true });
      return undefined;
    }
  };
}

/** Lo mismo para lo que el editor llama de forma síncrona (árbol): registra y devuelve `fallback`. */
export function guardSync<A extends unknown[], R>(log: HeftLog, where: string, fn: (...args: A) => R, fallback: (...args: A) => R): (...args: A) => R {
  return (...args: A) => {
    try {
      return fn(...args);
    } catch (err) {
      log.error(where, err, { notify: true });
      return fallback(...args);
    }
  };
}
