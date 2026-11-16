import type { Warning } from '../core/types.js';
import type { I18n } from './index.js';

/** Texto de un aviso del análisis en el idioma de quien lo enseña. */
export function warningText(w: Warning, I: I18n): string {
  switch (w.code) {
    case 'no-git':
      return I.t('warn.noGit');
    case 'git-history':
      return I.t('warn.gitHistory', { detail: w.detail });
    case 'unresolved-aliases':
      return I.t('warn.aliases', { n: I.num(w.count), prefixes: w.prefixes.join(', ') });
    case 'invalid-exclude':
      return invalidPatternsText('heftmap.exclude', w.patterns, I);
    case 'unresolved-imports':
      return I.t('warn.unresolved', { n: I.num(w.count), examples: w.examples.join(', ') });
  }
}

/** Aviso de patrones de un ajuste que no se pueden evaluar sin riesgo y se ignoran. */
export function invalidPatternsText(setting: string, patterns: readonly string[], I: I18n): string {
  return I.t('warn.exclude', { setting, patterns: patterns.map((p) => `«${p}»`).join(', ') });
}
