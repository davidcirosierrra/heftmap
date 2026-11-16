import { en, es, eu, type MessageKey, type Messages } from './messages.js';

/**
 * Idiomas de Heftmap: inglés (base), castellano y euskera. Sin dependencia de `vscode`: lo usan
 * la extensión, el panel (navegador) y el CLI.
 */
export type Locale = 'en' | 'es' | 'eu';
export const LOCALES: readonly Locale[] = ['en', 'es', 'eu'];
export type { MessageKey, Messages };

const DICTS: Record<Locale, Messages> = { en, es, eu };
/** Etiqueta BCP 47 del idioma (para `<html lang>` y para `Intl` si la conoce). */
const INTL_TAG: Record<Locale, string> = { en: 'en', es: 'es-ES', eu: 'eu-ES' };
/**
 * Chromium, y con él el panel dentro de VS Code, no trae datos de euskera para `Intl`: con
 * «eu-ES» formatea como en inglés. Si falta, se usan los separadores del castellano (los
 * mismos: punto de miles, coma decimal) y el signo de % y la fecha se montan a mano.
 */
const FALLBACK_TAG: Record<Locale, string> = { en: 'en', es: 'es-ES', eu: 'es-ES' };
/** Dónde va el signo de %: «51%», «51 %», «% 51». */
const PCT_PATTERN: Record<Locale, string> = { en: '{n}%', es: '{n} %', eu: '% {n}' };

function intlTag(locale: Locale): string {
  const tag = INTL_TAG[locale];
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length ? tag : FALLBACK_TAG[locale];
  } catch {
    return FALLBACK_TAG[locale];
  }
}

/** De la etiqueta del editor («es», «es-419», «eu», «en-US», «gl»…) a un idioma de Heftmap. */
export function resolveLocale(tag: string | null | undefined): Locale {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return base === 'es' || base === 'eu' ? base : 'en';
}

type Params = Record<string, string | number>;

export interface I18n {
  readonly locale: Locale;
  /** Etiqueta para `Intl` y para `<html lang>`. */
  readonly tag: string;
  /** Texto traducido con sus marcadores `{x}` sustituidos. */
  t(key: MessageKey, params?: Params): string;
  /** Plural: usa `base.one` con n = 1 y `base.other` en el resto. `{n}` ya va formateado. */
  tp(base: PluralBase, n: number, params?: Params): string;
  /** Número con los separadores del idioma. */
  num(n: number, maxDecimals?: number): string;
  /** Tamaño legible: «512 B», «14 KB», «1,5 MB». */
  size(bytes: number): string;
  /** Porcentaje: un decimal por debajo del 10 %; «<0,1 %» para lo minúsculo. */
  pct(x: number): string;
  /** Hace cuánto: «hoy», «hace 3 d», «duela 2 aste». */
  rel(time: number, now?: number): string;
  /** Duración de una fase: «850 ms», «2,15 s». */
  ms(ms: number): string;
  time(ms: number): string;
  date(ms: number): string;
}

/** Claves con variante `.one`/`.other`. */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer B}.one` ? (`${B}.other` extends MessageKey ? B : never) : never;
}[MessageKey];

const KB = 1024;
const MB = KB * 1024;
/** `Intl` separa número y signo con espacios duros; en una tabla da igual y así se busca y se prueba mejor. */
const plainSpaces = (s: string): string => s.replace(/[  ]/g, ' ');

const ymd = (d: Date): string => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

const cache = new Map<Locale, I18n>();

export function i18n(locale: Locale): I18n {
  const hit = cache.get(locale);
  if (hit) return hit;
  const dict = DICTS[locale];
  const tag = INTL_TAG[locale];
  const fmtTag = intlTag(locale);
  const nativeEu = locale === 'eu' && fmtTag === tag;
  const numFmt = new Map<number, Intl.NumberFormat>();
  const nf = (max: number): Intl.NumberFormat => {
    let f = numFmt.get(max);
    if (!f) numFmt.set(max, (f = new Intl.NumberFormat(fmtTag, { maximumFractionDigits: max })));
    return f;
  };
  // El % se monta a mano en los tres idiomas: el resultado no depende de los datos de `Intl`.
  const fixed = (n: number, digits: number): string =>
    plainSpaces(new Intl.NumberFormat(fmtTag, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n));
  const percent = (x: number, digits: number): string => PCT_PATTERN[locale].replace('{n}', fixed(x * 100, digits));

  const t = (key: MessageKey, params?: Params): string => {
    const text = dict[key] ?? en[key] ?? key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
  };
  const num = (n: number, maxDecimals = 0): string => plainSpaces(nf(maxDecimals).format(n));

  const api: I18n = {
    locale,
    tag,
    t,
    tp: (base, n, params) => t(`${base}.${n === 1 ? 'one' : 'other'}` as MessageKey, { ...params, n: num(n) }),
    num,
    size: (b) => {
      if (b < KB) return `${num(b)} B`;
      if (b < MB) return `${num(Math.round(b / KB))} KB`;
      const m = b / MB;
      return `${m >= 100 ? num(Math.round(m)) : plainSpaces(nf(1).format(Math.round(m * 10) / 10))} MB`;
    },
    pct: (x) => {
      if (x <= 0) return percent(0, 0);
      if (x < 0.001) return `<${percent(0.001, 1)}`;
      return percent(x, x >= 0.0995 ? 0 : 1);
    },
    rel: (time, now = Date.now()) => {
      const d = Math.floor((now - time) / 86_400_000);
      if (d <= 0) return t('rel.today');
      if (d === 1) return t('rel.yesterday');
      if (d < 7) return t('rel.days', { n: num(d) });
      if (d < 60) return t('rel.weeks', { n: num(Math.round(d / 7)) });
      if (d < 730) return t('rel.months', { n: num(Math.round(d / 30)) });
      return t('rel.years', { n: num(Math.round(d / 365)) });
    },
    ms: (ms) => (ms < 1000 ? `${num(Math.round(ms))} ms` : `${fixed(ms / 1000, 2)} s`),
    time: (ms) => new Date(ms).toLocaleTimeString(fmtTag),
    // En euskera la fecha va año/mes/día; sin datos de `Intl` se escribe a mano.
    date: (ms) => (locale === 'eu' && !nativeEu ? ymd(new Date(ms)) : new Date(ms).toLocaleDateString(fmtTag)),
  };
  cache.set(locale, api);
  return api;
}
