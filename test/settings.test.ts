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

describe('maxTextFileSize', () => {
  it('5 MB por defecto, recortado a 1–50 y pasado al análisis en bytes', () => {
    expect(readSettings().maxTextFileSize).toBe(5);
    fake.config.maxTextFileSize = 0.2;
    expect(readSettings().maxTextFileSize).toBe(1);
    fake.config.maxTextFileSize = 500;
    expect(readSettings().maxTextFileSize).toBe(50);
    fake.config.maxTextFileSize = 12;
    expect(toBuildOptions(readSettings(), true).maxTextBytes).toBe(12 * 1024 * 1024);
  });
});

describe('usage.weakSources', () => {
  it('sin lista válida, undefined (el núcleo pone la suya); una lista vacía vale', () => {
    expect(readSettings().usageWeakSources).toBeUndefined();
    fake.config['usage.weakSources'] = 'scripts';
    expect(readSettings().usageWeakSources).toBeUndefined();
    fake.config['usage.weakSources'] = [];
    expect(readSettings().usageWeakSources).toEqual([]);
    fake.config['usage.weakSources'] = ['gen', 3];
    expect(toBuildOptions(readSettings(), true).weakSources).toEqual(['gen']);
  });
});

describe('exclude', () => {
  it('lista de patrones; lo que no es texto se descarta', () => {
    expect(readSettings().exclude).toEqual([]);
    fake.config.exclude = ['dist', 7, '**/*.snap'];
    expect(toBuildOptions(readSettings(), true).exclude).toEqual(['dist', '**/*.snap']);
  });
});

describe('hotspots.exclude', () => {
  it('lista de patrones; no viaja al análisis (solo cambia lo que va al panel)', () => {
    fake.config['hotspots.exclude'] = ['vendor', null];
    expect(readSettings().hotspotsExclude).toEqual(['vendor']);
    expect(toBuildOptions(readSettings(), true)).not.toHaveProperty('hotspotsExclude');
  });
});

describe('toBuildOptions', () => {
  it('pasa los ajustes al análisis y la confianza decide si se usa git', () => {
    const s = readSettings();
    expect(toBuildOptions(s, true)).toEqual({ publicDir: 'public', since: undefined, ignore: [], entryPoints: [], maxTextBytes: 5 * 1024 * 1024, exclude: [], useGit: true });
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
