import { useSyncExternalStore } from 'react';
import { i18n, LOCALES, type I18n, type Locale } from '../i18n/index.js';

/**
 * Idioma del panel. Arranca con el que la extensión escribe en la página (`data-heft-locale`)
 * y cambia si llega otro en el estado (ajuste `heft.language`).
 */
function initial(): Locale {
  const attr = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-heft-locale') ?? document.documentElement.lang : '';
  return (LOCALES as readonly string[]).includes(attr) ? (attr as Locale) : 'en';
}

let current: I18n = i18n(initial());
const listeners = new Set<() => void>();

export function currentI18n(): I18n {
  return current;
}

export function setLocale(locale: Locale | undefined): void {
  if (!locale || locale === current.locale || !(LOCALES as readonly string[]).includes(locale)) return;
  current = i18n(locale);
  document.documentElement.lang = locale;
  for (const l of listeners) l();
}

/** Textos y formatos en el idioma activo; el componente se repinta si cambia. */
export function useI18n(): I18n {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
