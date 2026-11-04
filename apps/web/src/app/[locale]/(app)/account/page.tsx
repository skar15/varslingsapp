'use client';
import { refName } from '@varsling/shared';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { useHref, useLocale, useT } from '@/lib/i18n';
import { useAccount, useMe } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

export default function AccountPage() {
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const me = useMe();
  const account = useAccount();
  const [confirm, setConfirm] = useState('');
  if (!account.data || !me.data) return <main><p>{t('common.loading')}</p></main>;
  const a = account.data;
  const isOwner = me.data.user.effective_role === 'owner';
  return (
    <main className="stack" style={{ maxWidth: 640 }}>
      <h1>{t('account.title')}</h1>
      <div className="card stack">
        <p><strong>{t('account.plan')}:</strong> {a.plan ? refName(a.plan.name, locale) : '–'}</p>
        {a.plan && (
          <>
            <p>{t('account.usage.users', { used: a.usage.users + a.usage.pending_invitations, max: a.plan.max_users })}</p>
            <p>{t('account.usage.objects', { used: a.usage.objects, max: a.plan.max_objects })}</p>
            <p>{t('account.usage.sms', { used: a.usage.sms_this_month, max: a.plan.sms_monthly_cap })}</p>
          </>
        )}
        {a.status === 'past_due' && <p className="banner">{t('account.status.past_due')}</p>}
        {a.status === 'canceled' && <p className="banner">{t('account.status.canceled')}</p>}
        {isOwner && (
          <button className="btn btn-primary" onClick={async () => {
            const r = await unwrap(api.POST('/v1/billing/portal-session'));
            window.location.href = r.url;
          }}>{t('account.billing')}</button>
        )}
      </div>
      {isOwner && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{t('account.delete')}</h2>
          <p>{t('account.delete.confirm')}</p>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label={t('account.delete')} />
          <button className="btn btn-danger" disabled={confirm !== t('account.delete.word')} onClick={async () => {
            await unwrap(api.POST('/v1/account/deletion-request', { body: { confirm: true } }));
            await supabase().auth.signOut();
            window.location.href = href('/');
          }}>{t('account.delete')}</button>
        </div>
      )}
    </main>
  );
}
