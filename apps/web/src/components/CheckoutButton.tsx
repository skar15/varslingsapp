'use client';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

export function CheckoutButton({ planKey, label, disabled }: { planKey: string; label: string; disabled?: boolean }) {
  const locale = useLocale();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <button
        className="btn btn-primary"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            const r = await unwrap(api.POST('/v1/billing/checkout-session', { body: { plan_key: planKey, locale } }));
            window.location.href = r.url;
          } catch {
            setError(true);
            setBusy(false);
          }
        }}
      >
        {busy ? t('common.loading') : label}
      </button>
      {error && <span className="error">{t('common.error')}</span>}
    </>
  );
}
