'use client';
import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { supabase, toE164 } from '@/lib/supabase';

/** Phone OTP through Supabase Auth. Proves phone ownership, which SMS alerts need. */
export function PhoneOtp({ onVerified, submitLabel }: { onVerified: (phone: string) => void | Promise<void>; submitLabel?: string }) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const e164 = toE164(phone);
    if (!e164) return setError(t('auth.onlyNorwegianNumbers'));
    setBusy(true);
    setError(null);
    const { error: err } = await supabase().auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (err) return setError(t('auth.error'));
    setSentTo(e164);
  }

  async function verify() {
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase().auth.verifyOtp({ phone: sentTo, token: code.trim(), type: 'sms' });
    setBusy(false);
    if (err) return setError(t('auth.error'));
    await onVerified(sentTo);
  }

  return (
    <div className="stack">
      {!sentTo ? (
        <>
          <label>
            {t('auth.phone')}
            <input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+47 912 34 567" />
          </label>
          <button className="btn btn-primary" onClick={send} disabled={busy}>{t('auth.sendCode')}</button>
        </>
      ) : (
        <>
          <label>
            {t('auth.code')}
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn btn-primary" onClick={verify} disabled={busy || code.length < 4}>{submitLabel ?? t('auth.verify')}</button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
