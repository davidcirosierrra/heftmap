import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Locale } from '../i18n/index.js';
import type { HostMessage, PanelIndex, PanelStatus, WebviewMessage } from './panel-protocol.js';

/** Lo que el panel pide a la extensión. Los datos se piden, no se guardan aquí. */
export interface PanelHost {
  panelIndex(): PanelIndex | null;
  panelStatus(): PanelStatus;
  onPanelMessage(m: WebviewMessage): void;
}

/**
 * Panel «Heft» (SPEC §2.2): un único WebviewPanel. Esta clase solo crea el webview y pasa
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
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel('heft.panel', 'Heft', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [dist],
    });
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
    panel.webview.html = html(panel.webview, dist, this.host.panelStatus().locale ?? 'en');
  }

  /** El índice ha cambiado (pesa: solo se manda cuando cambia de verdad). */
  indexChanged(): void {
    if (this.ready) this.post({ type: 'index', index: this.host.panelIndex() });
  }

  /** Ámbito, avance o error: ligero, se manda en cada cambio. */
  statusChanged(): void {
    if (this.ready) this.post({ type: 'status', status: this.host.panelStatus() });
  }

  private post(m: HostMessage): void {
    void this.panel?.webview.postMessage(m);
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

/** El idioma va en la página para que el primer pintado («Cargando…») ya salga bien. */
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
<title>Heft</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}
