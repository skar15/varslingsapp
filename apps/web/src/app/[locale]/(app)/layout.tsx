'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Footer } from '@/components/Footer';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { useHref, useT } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

export default function AppLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const href = useHref();
  const router = useRouter();
  const path = usePathname();
  const me = useMe();

  useEffect(() => {
    if (me.isError) router.replace(href('/login'));
  }, [me.isError, router, href]);

  if (me.isLoading || me.isError || !me.data) return <main><p>{t('common.loading')}</p></main>;
  const role = me.data.user.effective_role;
  const links: [string, Parameters<typeof t>[0], boolean][] = [
    ['/dashboard', 'nav.dashboard', true],
    ['/users', 'nav.users', true],
    ['/proposals', 'nav.proposals', true],
    ['/settings', 'nav.settings', true],
    ['/account', 'nav.account', role === 'owner'],
  ];
  return (
    <>
      <nav className="top" aria-label={t('app.name')}>
        <div className="inner">
          <strong>{t('app.name')}</strong>
          {links.filter((l) => l[2]).map(([p, key]) => (
            <a key={p} href={href(p)} aria-current={path?.endsWith(p) ? 'page' : undefined}>{t(key)}</a>
          ))}
          <span style={{ flex: 1 }} />
          <LocaleSwitch />
          <button className="btn" onClick={async () => { await supabase().auth.signOut(); router.replace(href('/login')); }}>{t('common.signOut')}</button>
        </div>
      </nav>
      {me.data.account.status === 'past_due' && <main style={{ paddingBottom: 0 }}><p className="banner" role="status">{t('account.status.past_due')}</p></main>}
      {children}
      <Footer />
    </>
  );
}
