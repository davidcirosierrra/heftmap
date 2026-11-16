import type { WebviewMessage } from '../extension/panel-protocol.js';

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
  getState(): unknown;
  /** Ojo: devuelve el estado que recibe. No usar como cuerpo de un `useEffect`. */
  setState<T>(s: T): T;
}
declare function acquireVsCodeApi(): VsCodeApi;

/** Solo se puede pedir una vez por carga del webview. */
export const vscode = acquireVsCodeApi();

export const post = (m: WebviewMessage): void => vscode.postMessage(m);
