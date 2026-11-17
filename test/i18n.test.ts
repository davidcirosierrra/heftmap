import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { i18n, LOCALES, resolveLocale } from '../src/i18n/index.js';
import { en, es, eu } from '../src/i18n/messages.js';
import { warningText } from '../src/i18n/warnings.js';

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('idiomas: diccionarios', () => {
  it('los tres tienen las mismas claves y ninguna vacía', () => {
    for (const dict of [es, eu]) {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(dict)) expect(v.trim(), k).not.toBe('');
    }
  });

  it('cada traducción usa los mismos marcadores que el inglés', () => {
    for (const [name, dict] of Object.entries({ es, eu })) {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        // En singular se puede escribir el número con letra («fitxategi batek»): {n} es opcional.
        const want = placeholders(en[key]).filter((p) => !(key.endsWith('.one') && p === 'n'));
        const got = placeholders(dict[key]).filter((p) => !(key.endsWith('.one') && p === 'n'));
        expect(got, `${name}: ${key}`).toEqual(want);
      }
    }
  });

  it('los plurales vienen en pareja', () => {
    for (const key of Object.keys(en)) {
      if (key.endsWith('.one')) expect(Object.keys(en)).toContain(key.replace(/\.one$/, '.other'));
    }
  });
});

describe('idiomas: elección', () => {
  it('del idioma del editor al de Heftmap; lo desconocido, inglés', () => {
    expect(resolveLocale('es')).toBe('es');
    expect(resolveLocale('es-419')).toBe('es');
    expect(resolveLocale('eu')).toBe('eu');
    expect(resolveLocale('EU-es')).toBe('eu');
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('gl')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(LOCALES).toEqual(['en', 'es', 'eu']);
  });
});

describe('idiomas: formatos', () => {
  const [EN, ES, EU] = [i18n('en'), i18n('es'), i18n('eu')];
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 10, 16);

  it('tamaños', () => {
    expect([EN.size(512), EN.size(14_000), EN.size(1_572_864), EN.size(250 * 1024 * 1024)]).toEqual(['512 B', '14 KB', '1.5 MB', '250 MB']);
    expect(ES.size(1_572_864)).toBe('1,5 MB');
    expect(EU.size(1_572_864)).toBe('1,5 MB');
  });

  it('porcentajes: el signo va donde lo pone cada idioma', () => {
    expect([EN.pct(0.51), EN.pct(0.034), EN.pct(0.0004), EN.pct(0)]).toEqual(['51%', '3.4%', '<0.1%', '0%']);
    expect([ES.pct(0.51), ES.pct(0.034), ES.pct(0.0004)]).toEqual(['51 %', '3,4 %', '<0,1 %']);
    expect([EU.pct(0.51), EU.pct(0.034)]).toEqual(['% 51', '% 3,4']);
  });

  it('números y plurales', () => {
    expect(EN.tp('files', 1)).toBe('1 file');
    expect(EN.tp('files', 3006)).toBe('3,006 files');
    expect(ES.tp('files', 1)).toBe('1 archivo');
    expect(EU.tp('files', 1)).toBe('fitxategi 1');
    expect(EU.tp('files', 12)).toBe('12 fitxategi');
  });

  it('fechas relativas', () => {
    expect([EN.rel(now, now), EN.rel(now - DAY, now), EN.rel(now - 3 * DAY, now), EN.rel(now - 90 * DAY, now)]).toEqual(['today', 'yesterday', '3 d ago', '3 mo ago']);
    expect(ES.rel(now - 3 * DAY, now)).toBe('hace 3 d');
    expect(EU.rel(now - 3 * DAY, now)).toBe('duela 3 egun');
    expect(EU.rel(now - 800 * DAY, now)).toBe('duela 2 urte');
  });

  it('fechas relativas finas: minutos, horas y días', () => {
    const MIN = 60_000;
    expect([EN.relFine(now, now), EN.relFine(now - 20 * MIN, now), EN.relFine(now - 5 * 60 * MIN, now), EN.relFine(now - 12 * DAY, now)]).toEqual([
      'now',
      '20 min ago',
      '5 h ago',
      '12 d ago',
    ]);
    expect(ES.relFine(now - 30 * 60 * MIN, now)).toBe('hace 30 h');
    expect(EU.relFine(now - 3 * 60 * MIN, now)).toBe('duela 3 ordu');
    expect(EU.relFine(now - 10 * MIN, now)).toBe('duela 10 min');
  });

  it('euskera sin datos de Intl (como en Chromium): separadores del castellano, % y fecha a la vasca', async () => {
    const real = Intl.NumberFormat.supportedLocalesOf;
    Intl.NumberFormat.supportedLocalesOf = ((tags: string[]) => tags.filter((t) => !t.startsWith('eu'))) as typeof real;
    try {
      // Módulo nuevo: la caché de idiomas no debe reutilizar el euskera con datos nativos.
      const { vi } = await import('vitest');
      vi.resetModules();
      const fresh = await import('../src/i18n/index.js');
      const E = fresh.i18n('eu');
      expect([E.num(12345.6, 1), E.size(1_572_864), E.pct(0.034), E.pct(0.51)]).toEqual(['12.345,6', '1,5 MB', '% 3,4', '% 51']);
      expect(E.date(new Date(2026, 10, 12).getTime())).toBe('2026/11/12');
      expect(E.time(new Date(2026, 10, 16, 15, 3, 9).getTime())).toBe('15:03:09');
    } finally {
      Intl.NumberFormat.supportedLocalesOf = real;
    }
  });

  it('duraciones', () => {
    expect([EN.ms(850), EN.ms(2150)]).toEqual(['850 ms', '2.15 s']);
    expect(ES.ms(2150)).toBe('2,15 s');
  });

  it('marcadores sin valor se quedan a la vista (mejor que un hueco)', () => {
    expect(EN.t('trash.confirm', {})).toBe('Move «{path}» to the trash?');
  });

  it('avisos del análisis', () => {
    expect(warningText({ code: 'no-git' }, ES)).toContain('No se encuentra «git»');
    expect(warningText({ code: 'unresolved-imports', count: 2, examples: ['a.ts → ./b', 'c.ts → ./d'] }, EN)).toBe(
      '2 unresolved relative imports (e.g. a.ts → ./b, c.ts → ./d)',
    );
  });
});

describe('idiomas: package.json', () => {
  const pkg = readFileSync('package.json', 'utf8');
  const used = [...pkg.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]!).sort();
  const nls = (suffix: string): Record<string, string> => JSON.parse(readFileSync(`package.nls${suffix}.json`, 'utf8'));

  it('cada %clave% del package.json está en los tres package.nls', () => {
    expect(used.length).toBeGreaterThan(15);
    for (const suffix of ['', '.es', '.eu']) {
      expect(Object.keys(nls(suffix)).sort(), suffix || 'en').toEqual([...new Set(used)].sort());
    }
  });

  it('el ajuste heftmap.language ofrece los tres idiomas', () => {
    const lang = JSON.parse(pkg).contributes.configuration.properties['heftmap.language'];
    expect(lang.enum).toEqual(['auto', 'en', 'es', 'eu']);
    expect(lang.default).toBe('auto');
  });
});

describe('walkthrough de primer uso (plan, paso 3.7)', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const ignore = readFileSync('.vscodeignore', 'utf8');

  it('cuatro pasos: panel, ámbito, sin rastro y hotspots', () => {
    const [w] = pkg.contributes.walkthroughs;
    expect(w.steps.map((s: { id: string }) => s.id)).toEqual(['openPanel', 'scope', 'noTrace', 'hotspots']);
  });

  it('sus imágenes existen y entran en el .vsix', () => {
    for (const step of pkg.contributes.walkthroughs[0].steps) {
      expect(existsSync(step.media.image), step.media.image).toBe(true);
      expect(step.media.image.startsWith('docs/images/')).toBe(true);
    }
    expect(ignore).toContain('!docs/images/**');
  });

  it('los comandos de sus enlaces existen', () => {
    const declared = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    const nls = JSON.parse(readFileSync('package.nls.json', 'utf8')) as Record<string, string>;
    const linked = Object.entries(nls)
      .filter(([k]) => k.startsWith('walkthrough.'))
      .flatMap(([, v]) => [...v.matchAll(/\(command:([\w.]+)\)/g)].map((m) => m[1]));
    expect(linked.length).toBeGreaterThan(0);
    for (const c of linked) expect(declared.has(c), c).toBe(true);
  });
});
