import { act } from 'react';
import type { HostMessage, WebviewMessage } from '../src/extension/panel-protocol.js';

/**
 * Arranca el panel real (React) en jsdom con un `acquireVsCodeApi` que se comporta como
 * el del editor. Importante: el `setState` real **devuelve** el estado que recibe.
 */
export interface Harness {
  sent: WebviewMessage[];
  state: unknown;
  root: HTMLElement;
  send(m: HostMessage): Promise<void>;
  click(el: Element | null | undefined): Promise<void>;
  dblclick(el: Element | null | undefined): Promise<void>;
  choose(el: Element | null | undefined, value: string): Promise<void>;
  type(el: Element | null | undefined, value: string): Promise<void>;
  key(el: Element | null | undefined, key: string): Promise<void>;
  $(sel: string): HTMLElement | null;
  $$(sel: string): HTMLElement[];
  text(sel: string): string[];
}

export async function mountPanel(savedState?: unknown): Promise<Harness> {
  const g = globalThis as any;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.ResizeObserver ??= class {
    observe(): void {}
    disconnect(): void {}
  };
  // jsdom no calcula tamaños: sin esto la tabla y el treemap medirían 0×0.
  for (const [prop, value] of [['clientWidth', 800], ['clientHeight', 480]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }
  const h = { sent: [] as WebviewMessage[], state: savedState };
  g.acquireVsCodeApi = () => ({
    postMessage: (m: WebviewMessage) => void h.sent.push(m),
    getState: () => h.state,
    setState: (s: unknown) => (h.state = s),
  });
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root') as HTMLElement;
  await act(async () => {
    await import('../src/webview/main.js');
  });
  const need = <T,>(el: T | null | undefined): T => {
    if (!el) throw new Error('no existe el elemento');
    return el;
  };
  return {
    get sent() {
      return h.sent;
    },
    get state() {
      return h.state;
    },
    root,
    send: (m) => act(async () => void window.dispatchEvent(new MessageEvent('message', { data: m }))),
    click: (el) => act(async () => void need(el).dispatchEvent(new MouseEvent('click', { bubbles: true }))),
    dblclick: (el) => act(async () => void need(el).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))),
    choose: (el, value) =>
      act(async () => {
        const select = need(el) as HTMLSelectElement;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    type: (el, value) =>
      act(async () => {
        const input = need(el) as HTMLInputElement;
        // React vigila el setter nativo: hay que llamarlo para que vea el cambio.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }),
    key: (el, key) => act(async () => void need(el).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))),
    $: (sel) => root.querySelector<HTMLElement>(sel),
    $$: (sel) => [...root.querySelectorAll<HTMLElement>(sel)],
    text: (sel) => [...root.querySelectorAll(sel)].map((e) => e.textContent ?? ''),
  };
}

export const status = (o: Partial<Extract<HostMessage, { type: 'status' }>['status']> = {}): HostMessage => ({
  type: 'status',
  status: { hasRoot: true, scope: [], building: false, progress: null, fraction: null, error: null, ...o },
});
