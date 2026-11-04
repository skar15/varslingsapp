'use client';
import { usePathname } from 'next/navigation';
import { useLocale, useT } from '@/lib/i18n';

export function LocaleSwitch() {
  const locale = useLocale();
  const t = useT();
  const path = usePathname() ?? '/';
  const other = locale === 'nb' ? 'en' : 'nb';
  const href = path.replace(/^\/(nb|en)/, `/${other}`);
  return (
    <a href={href} onClick={() => (document.cookie = `locale=${other}; path=/; max-age=31536000; samesite=lax`)} lang={other} title={t('common.language')}>
      {other === 'en' ? 'English' : 'Norsk'}
    </a>
  );
}
