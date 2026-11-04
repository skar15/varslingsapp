'use client';
import { useT } from '@/lib/i18n';

export function Footer() {
  const t = useT();
  return (
    <footer className="footer">
      <p>{t('alert.authoritative')}</p>
      <p>
        <a href="https://www.varsom.no" rel="noreferrer">varsom.no</a> · <a href="https://www.yr.no" rel="noreferrer">yr.no</a>
      </p>
    </footer>
  );
}
