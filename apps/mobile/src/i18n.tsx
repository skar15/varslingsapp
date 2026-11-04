import { normaliseLocale, t as translate, type I18nKey, type I18nParams, type Locale } from '@varsling/shared';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

const deviceLocale = normaliseLocale(Intl.DateTimeFormat().resolvedOptions().locale);
const LocaleContext = createContext<Locale>(deviceLocale);

export function LocaleProvider({ locale, children }: { locale?: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale ?? deviceLocale}>{children}</LocaleContext.Provider>;
}
export const useLocale = () => useContext(LocaleContext);
export function useT() {
  const locale = useLocale();
  return useCallback((key: I18nKey, params?: I18nParams) => translate(locale, key, params), [locale]);
}
export { deviceLocale };
