// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mountPanel, status, type Harness } from './webview-harness.js';

/** Pantalla de errores del panel: un fallo al pintar o en ejecución se ve y llega al registro. */
let p: Harness;
const errorsSent = () => p.sent.filter((m) => m.type === 'error') as { where: string; message: string; stack?: string }[];

beforeAll(async () => {
  p = await mountPanel();
  await p.send(status());
});

describe('panel (DOM): errores', () => {
  it('un error en ejecución sale en una banda, sin tapar el panel, y se manda al registro', async () => {
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, files: [{ path: 'a.ts', size: 1 }] } });
    const { act } = await import('react');
    await act(async () => void window.dispatchEvent(new ErrorEvent('error', { error: new Error('algo falló'), message: 'algo falló' })));
    expect(p.$('.runtime-error .msg')?.textContent).toBe('Error: algo falló');
    expect(p.text('.body .row .name')).toEqual(['a.ts']);
    expect(errorsSent().at(-1)).toMatchObject({ where: 'en ejecución', message: 'algo falló' });
    await p.click(p.$$('.runtime-error .link')[0]);
    expect(p.$('.runtime-error .stack')?.textContent).toContain('algo falló');
    await p.click(p.$$('.runtime-error .link')[1]);
    expect(p.$('.runtime-error')).toBeNull();
  });

  it('un fallo al pintar enseña el error con su traza en vez de dejar la pestaña en blanco', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Datos imposibles: `files` no es una lista.
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, files: 42 as never } });
    quiet.mockRestore();
    expect(p.$('.crash h1')?.textContent).toBe('El panel de Heft ha fallado');
    expect(p.$('.crash .stack')?.textContent).toMatch(/not iterable|is not a function/);
    expect(errorsSent().at(-1)?.where).toBe('al pintar');
  });

  it('copiar el error y ver el registro piden a la extensión que lo haga', async () => {
    const buttons = p.$$('.crash .actions button');
    await p.click(buttons.find((b) => b.textContent === 'Copiar el error'));
    expect(p.sent.at(-1)).toMatchObject({ type: 'copy' });
    await p.click(buttons.find((b) => b.textContent === 'Ver el registro'));
    expect(p.sent.at(-1)).toEqual({ type: 'showLog' });
  });

  it('«Reintentar» vuelve a pintar cuando los datos ya son buenos', async () => {
    // Con el panel caído no hay quien escuche: el dato bueno llega tras reintentar.
    await p.click(p.$$('.crash .actions button').find((b) => b.textContent === 'Reintentar'));
    await p.send(status());
    await p.send({ type: 'index', index: { rootName: 'kart', complete: true, files: [{ path: 'b.ts', size: 2 }] } });
    expect(p.$('.crash')).toBeNull();
    expect(p.text('.body .row .name')).toEqual(['b.ts']);
  });
});
