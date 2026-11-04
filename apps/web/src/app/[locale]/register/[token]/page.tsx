'use client';
import { useQuery } from '@tanstack/react-query';
import { ACCOUNT_KINDS, refName, type AccountKind } from '@varsling/shared';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhoneOtp } from '@/components/PhoneOtp';
import { api, unwrap } from '@/lib/api';
import { useHref, useLocale, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

/**
 * Registration after Stripe Checkout, protected by the one-time claim token. The webhook may
 * arrive a few seconds after the redirect, so the claim is retried while it is not yet known.
 */
export default function RegisterPage() {
  const { token } = useParams<{ token: string }>();
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const router = useRouter();
  const claim = useQuery({
    queryKey: ['claim', token],
    queryFn: () => unwrap(api.GET('/v1/claim/{token}', { params: { path: { token } } })),
    retry: 6,
    retryDelay: 2000,
  });
  const [phone, setPhone] = useState<string | null>(null);
  const [kind, setKind] = useState<AccountKind>('person');
  const [legalName, setLegalName] = useState('');
  const [orgNumber, setOrgNumber] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (claim.isLoading) return <main><p>{t('common.loading')}</p></main>;
  if (claim.isError || !claim.data) return <main><p className="error">{t('register.invalidToken')}</p></main>;

  const orgOk = kind === 'person' || /^\d{9}$/.test(orgNumber.replace(/\s/g, ''));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!adult) return setError(t('register.under18'));
    if (!orgOk) return setError(t('register.orgNumberInvalid'));
    setBusy(true);
    setError(null);
    try {
      if (email && password) await supabase().auth.updateUser({ email, password });
      await unwrap(
        api.POST('/v1/claim/{token}/complete', {
          params: { path: { token } },
          body: {
            kind, owner_name: ownerName, locale, accept_terms: true, confirm_adult: true,
            ...(kind !== 'person' ? { legal_name: legalName, org_number: orgNumber.replace(/\s/g, '') } : {}),
          },
        }),
      );
      router.push(href('/dashboard'));
    } catch {
      setError(t('common.error'));
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 520 }}>
      <h1>{t('register.title')}</h1>
      <p className="muted">{t('account.plan')}: {refName(claim.data.plan.name, locale)}</p>
      <div className="card stack">
        <h2 style={{ marginTop: 0 }}>{t('register.verifyPhone')}</h2>
        {phone ? <p>✓ {t('register.phoneVerified')} ({phone})</p> : <PhoneOtp onVerified={setPhone} />}
      </div>
      {phone && (
        <form className="card stack" style={{ marginTop: 12 }} onSubmit={submit}>
          <label>
            {t('register.kind')}
            <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
              {ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{t(`register.kind.${k}`)}</option>)}
            </select>
          </label>
          {kind !== 'person' && (
            <>
              <label>{t('register.legalName')}<input value={legalName} onChange={(e) => setLegalName(e.target.value)} required /></label>
              <label>{t('register.orgNumber')}<input inputMode="numeric" value={orgNumber} onChange={(e) => setOrgNumber(e.target.value)} required /></label>
            </>
          )}
          <label>{t('register.ownerName')}<input autoComplete="name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required /></label>
          <label>{t('register.email')}<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={claim.data.email ?? ''} /></label>
          <label>{t('register.password')}<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required /> {t('register.acceptTerms')}</label>
          <label className="check"><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> {t('register.confirmAdult')}</label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !terms || !ownerName}>{t('common.next')}</button>
        </form>
      )}
    </main>
  );
}
