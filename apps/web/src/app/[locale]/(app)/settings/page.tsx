'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useMe } from '@/lib/queries';

/** Notification settings. Push permission is managed in the mobile app. */
export default function SettingsPage() {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe();
  const [sent, setSent] = useState(false);
  if (!me.data) return <main><p>{t('common.loading')}</p></main>;
  const u = me.data.user;
  const patch = async (body: { sms_for_all_levels?: boolean; locale?: 'nb' | 'en'; name?: string }) => {
    await unwrap(api.PATCH('/v1/me', { body }));
    await qc.invalidateQueries({ queryKey: ['me'] });
  };
  return (
    <main className="stack" style={{ maxWidth: 560 }}>
      <h1>{t('nav.settings')}</h1>
      <div className="card stack">
        <label className="check">
          <input type="checkbox" checked={u.sms_for_all_levels} onChange={(e) => patch({ sms_for_all_levels: e.target.checked })} /> {t('settings.smsAll')}
        </label>
        <p className="muted">{t('settings.smsAll.help')}</p>
        <label>{t('settings.language')}
          <select value={u.locale} onChange={(e) => patch({ locale: e.target.value as 'nb' | 'en' })}>
            <option value="nb">Norsk (bokmål)</option>
            <option value="en">English</option>
          </select>
        </label>
        <p>{t('auth.phone')}: {u.phone_e164 ?? '–'} {u.phone_verified ? '✓' : ''}</p>
        <button className="btn" onClick={async () => { await unwrap(api.POST('/v1/me/test-notification')); setSent(true); }}>{t('settings.test')}</button>
        {sent && <p role="status">{t('settings.testSent')}</p>}
      </div>
    </main>
  );
}
