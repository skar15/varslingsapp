'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhoneOtp } from '@/components/PhoneOtp';
import { api, ApiError, unwrap } from '@/lib/api';
import { useHref, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

/** Sign in. No prices and no buy buttons here (D6 applies to the app; the web mirrors it). */
export default function LoginPage() {
  const t = useT();
  const href = useHref();
  const router = useRouter();
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function afterSignIn() {
    try {
      await unwrap(api.GET('/v1/me'));
      router.push(href('/dashboard'));
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'not_a_member' ? t('auth.notMember') : t('auth.error'));
      await supabase().auth.signOut();
    }
  }

  return (
    <main style={{ maxWidth: 420 }}>
      <h1>{t('auth.signIn')}</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'email'} onClick={() => setMode('email')}>{t('auth.withEmail')}</button>
        <button role="tab" aria-selected={mode === 'phone'} onClick={() => setMode('phone')}>{t('auth.withPhone')}</button>
      </div>
      <div className="card stack" style={{ marginTop: 12 }}>
        {mode === 'email' ? (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              const { error: err } = await supabase().auth.signInWithPassword({ email, password });
              if (err) return setError(t('auth.error'));
              await afterSignIn();
            }}
          >
            <label>
              {t('auth.email')}
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              {t('auth.password')}
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button className="btn btn-primary" type="submit">{t('auth.signIn')}</button>
          </form>
        ) : (
          <PhoneOtp onVerified={afterSignIn} submitLabel={t('auth.signIn')} />
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <p className="muted">{t('auth.accountsOnWeb')} <a href={href('/#plans')}>{t('landing.plans')}</a></p>
    </main>
  );
}
