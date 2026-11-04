import type { Locale } from '../enums';
import { en } from './en';
import { nb, type I18nKey } from './nb';

export { nb, en };
export type { I18nKey };

const dictionaries: Record<Locale, Record<I18nKey, string>> = { nb, en };

export type I18nParams = Record<string, string | number>;

export function t(locale: Locale, key: I18nKey, params?: I18nParams): string {
  const template = dictionaries[locale]?.[key] ?? nb[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function isI18nKey(key: string): key is I18nKey {
  return key in nb;
}

export function normaliseLocale(raw: string | null | undefined): Locale {
  return raw?.toLowerCase().startsWith('en') ? 'en' : 'nb';
}

/** Reference-data names come from the i18n column (nb, en). */
export function refName(i18n: { nb: string; en?: string } | null | undefined, locale: Locale): string {
  if (!i18n) return '';
  return (locale === 'en' ? i18n.en : undefined) ?? i18n.nb;
}
