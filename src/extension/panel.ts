import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { i18n, type Locale } from '../i18n/index.js';
import type { HostMessage, PanelIndex, PanelStatus, WebviewMessage } from './panel-protocol.js';

/** Lo que el panel pide a la extensión. Los datos se piden, no se guardan aquí. */
export interface PanelHost {
  panelIndex(): PanelIndex | null;
  panelStatus(): PanelStatus;
  onPanelMessage(m: WebviewMessage): void;
}

/** Tipo del webview: lo comparten `createWebviewPanel`, el serializador y `onWebviewPanel:` en package.json. */
export const PANEL_VIEW_TYPE = 'heftmap.panel';

/**
 * Panel «Heftmap» (SPEC §2.2): un único WebviewPanel. Esta clase solo crea el webview y pasa
 * mensajes; la interfaz vive en `src/webview/` (bundle aparte, `dist/webview.js`).
 *
 * El webview se descarga al ocultarse la pestaña y se vuelve a cargar al mostrarse: por eso
 * no se le empuja nada hasta que dice `ready`, y entonces se le manda todo.
 */
export class HeftPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: PanelHost,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.attach(
      vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, 'Heftmap', vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [this.dist],
      }),
    );
  }

  /**
   * Adopta el panel que el editor devuelve al recargar la ventana (serializador). Llega sin
   * opciones, sin página y sin oyentes: se le pone todo como a uno nuevo. Los datos no se
   * guardan: los pide con `ready`, igual que al abrirlo en frío. El estado de la interfaz
   * (orden, filtro, zoom…) lo conserva el editor con `setState`.
   */
  restore(panel: vscode.WebviewPanel): void {
    // Solo hay un panel: si ya hay otro abierto, el restaurado sobra.
    if (this.panel) {
      panel.dispose();
      return;
    }
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.dist] };
    this.attach(panel);
  }

  private get dist(): vscode.Uri {
    return vscode.Uri.joinPath(this.extensionUri, 'dist');
  }

  private attach(panel: vscode.WebviewPanel): void {
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'heft.svg');
    panel.webview.onDidReceiveMessage((m: WebviewMessage) => {
      if (m.type === 'ready') {
        this.ready = true;
        this.post({ type: 'status', status: this.host.panelStatus() });
        this.post({ type: 'index', index: this.host.panelIndex() });
        return;
      }
      this.host.onPanelMessage(m);
    });
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.ready = false;
    });
    this.panel = panel;
    this.ready = false;
    panel.webview.html = html(panel.webview, this.dist, this.host.panelStatus().locale ?? 'en');
  }

  /** El índice ha cambiado (pesa: solo se manda cuando cambia de verdad). */
  indexChanged(): void {
    if (this.ready) this.post({ type: 'index', index: this.host.panelIndex() });
  }

  /** Ámbito, avance o error: ligero, se manda en cada cambio. */
  statusChanged(): void {
    if (this.ready) this.post({ type: 'status', status: this.host.panelStatus() });
  }

  /** Pide al panel las filas que se ven para copiarlas. false si no hay panel listo. */
  requestExport(): boolean {
    if (!this.ready) return false;
    this.post({ type: 'requestExport' });
    return true;
  }

  private post(m: HostMessage): void {
    void this.panel?.webview.postMessage(m);
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

/**
 * El idioma va en la página para que el primer pintado («Cargando…») ya salga bien.
 *
 * `#root` lleva ya la misma pantalla de carga que pinta React (`Splash` en App.tsx): el
 * bundle pesa ~300 KB y, mientras se descarga, se analiza y monta React, el panel se quedaba
 * en blanco (al abrirlo, al recargar la ventana y al volver a la pestaña, porque el webview
 * se descarga al ocultarse). React sustituye este contenido en su primer render.
 */
function html(webview: vscode.Webview, dist: vscode.Uri, locale: Locale): string {
  const nonce = randomBytes(16).toString('base64');
  const js = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
  const css = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
  const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'`;
  return `<!doctype html>
<html lang="${locale}" data-heft-locale="${locale}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
<title>Heftmap</title>
</head>
<body>
<div id="root"><div class="splash" role="status"><span class="spinner"></span><h1>${escapeHtml(i18n(locale).t('panel.loading'))}</h1></div></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
