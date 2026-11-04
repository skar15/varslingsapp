'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhoneOtp } from '@/components/PhoneOtp';
import { api, unwrap } from '@/lib/api';
import { useHref, useLocale, useT } from '@/lib/i18n';

/** The invited person verifies the phone by OTP and sets their name. */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <main style={{ maxWidth: 420 }}>
      <h1>{t('invite.accept.title')}</h1>
      <div className="card stack">
        {!verified ? (
          <PhoneOtp onVerified={() => setVerified(true)} />
        ) : (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await unwrap(api.POST('/v1/invitations/{token}/accept', { params: { path: { token } }, body: { name, locale } }));
                router.push(href('/dashboard'));
              } catch {
                setError(t('invite.invalid'));
              }
            }}
          >
            <label>{t('settings.name')}<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>
            <button className="btn btn-primary" type="submit">{t('invite.accept.button')}</button>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
