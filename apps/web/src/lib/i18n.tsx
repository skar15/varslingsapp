'use client';
import { normaliseLocale, t as translate, type I18nKey, type I18nParams, type Locale } from '@varsling/shared';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

const LocaleContext = createContext<Locale>('nb');

export function LocaleProvider({ locale, children }: { locale: string; children: ReactNode }) {
  return <LocaleContext.Provider value={normaliseLocale(locale)}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useLocale();
  return useCallback((key: I18nKey, params?: I18nParams) => translate(locale, key, params), [locale]);
}

export function useHref() {
  const locale = useLocale();
  return useCallback((path: string) => `/${locale}${path.startsWith('/') ? path : `/${path}`}`, [locale]);
}
