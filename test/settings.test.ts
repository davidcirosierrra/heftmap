import { beforeEach, describe, expect, it } from 'vitest';
import { addUsageIgnore, readSettings, toBuildOptions } from '../src/extension/settings.js';
import { fake, Uri } from './fake-vscode.js';

/** Lectura y validación de los ajustes (`settings.ts`, plan fase 2). */
beforeEach(() => fake.reset('/repo'));

describe('readSettings', () => {
  it('sin nada configurado da los valores por defecto', () => {
    expect(readSettings()).toEqual({
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
    expect(readSettings()).toEqual({
      language: 'eu',
      publicDir: 'static',
      gitSince: '1.year',
      usageIgnore: ['a.png'],
      usageEntryPoints: ['src/x.ts'],
    });
  });

  it('un valor del tipo equivocado cuenta como el valor por defecto', () => {
    Object.assign(fake.config, { language: 3, publicDir: '', 'git.since': ['x'], 'usage.ignore': 'a.png', 'usage.entryPoints': ['ok.ts', 7, null] });
    expect(readSettings()).toEqual({
      language: 'auto',
      publicDir: 'public',
      gitSince: undefined,
      usageIgnore: [],
      usageEntryPoints: ['ok.ts'],
    });
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
