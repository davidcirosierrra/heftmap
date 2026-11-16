import { beforeEach, describe, expect, it } from 'vitest';
import { addUsageIgnore, readSettings, toBuildOptions } from '../src/extension/settings.js';
import { fake, Uri } from './fake-vscode.js';

/** Lectura y validación de los ajustes (`settings.ts`, plan fase 2). */
beforeEach(() => fake.reset('/repo'));

describe('readSettings', () => {
  it('sin nada configurado da los valores por defecto', () => {
    expect(readSettings()).toMatchObject({
      language: 'auto',
      publicDir: 'public',
      gitSince: undefined,
      usageIgnore: [],
      usageEntryPoints: [],
    });
  });

  it('lee lo configurado', () => {
    Object.assign(fake.config, {
      language: 'eu',
      publicDir: 'static',
      'git.since': '1.year',
      'usage.ignore': ['a.png'],
      'usage.entryPoints': ['src/x.ts'],
    });
    expect(readSettings()).toMatchObject({
      language: 'eu',
      publicDir: 'static',
      gitSince: '1.year',
      usageIgnore: ['a.png'],
      usageEntryPoints: ['src/x.ts'],
    });
  });

  it('un valor del tipo equivocado cuenta como el valor por defecto', () => {
    Object.assign(fake.config, { language: 3, publicDir: '', 'git.since': ['x'], 'usage.ignore': 'a.png', 'usage.entryPoints': ['ok.ts', 7, null] });
    expect(readSettings()).toMatchObject({
      language: 'auto',
      publicDir: 'public',
      gitSince: undefined,
      usageIgnore: [],
      usageEntryPoints: ['ok.ts'],
    });
  });
});

describe('refreshDelay y autoRefresh', () => {
  it('por defecto 1500 ms y automático', () => {
    expect(readSettings()).toMatchObject({ refreshDelay: 1500, autoRefresh: true });
  });

  it('el retardo se recorta a 250–60000 y se redondea; si no es número, el de por defecto', () => {
    const delay = (v: unknown): number => {
      fake.config.refreshDelay = v;
      return readSettings().refreshDelay;
    };
    expect(delay(3000)).toBe(3000);
    expect(delay(10)).toBe(250);
    expect(delay(1e9)).toBe(60000);
    expect(delay(999.6)).toBe(1000);
    expect(delay('2000')).toBe(1500);
    expect(delay(Number.NaN)).toBe(1500);
  });

  it('autoRefresh solo acepta booleanos', () => {
    fake.config.autoRefresh = false;
    expect(readSettings().autoRefresh).toBe(false);
    fake.config.autoRefresh = 'no';
    expect(readSettings().autoRefresh).toBe(true);
  });
});

describe('toBuildOptions', () => {
  it('pasa los ajustes al análisis y la confianza decide si se usa git', () => {
    const s = readSettings();
    expect(toBuildOptions(s, true)).toEqual({ publicDir: 'public', since: undefined, ignore: [], entryPoints: [], useGit: true });
    expect(toBuildOptions(s, false).useGit).toBe(false);
  });
});

describe('addUsageIgnore', () => {
  it('añade ordenado al workspace y no repite', async () => {
    fake.config['usage.ignore'] = ['z.png'];
    expect(await addUsageIgnore(Uri.file('/repo') as any, 'a.png')).toBe(true);
    expect(fake.config['usage.ignore']).toEqual(['a.png', 'z.png']);
    expect(await addUsageIgnore(Uri.file('/repo') as any, 'a.png')).toBe(false);
  });
});
