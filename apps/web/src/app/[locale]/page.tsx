import { normaliseLocale, refName, t } from '@varsling/shared';
import Link from 'next/link';
import { publicApi } from '@/lib/api';
import { CheckoutButton } from '@/components/CheckoutButton';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { Footer } from '@/components/Footer';

// Rendered per request so plans always reflect the API (an empty build-time snapshot must never be cached).
export const dynamic = 'force-dynamic';

async function loadPlans() {
  try {
    const r = await publicApi.GET('/v1/plans');
    return r.data?.items ?? [];
  } catch {
    return [];
  }
}

/** Landing page with plans. Prices are only shown in Stripe Checkout (D11: no hard-coded prices). */
export default async function Landing({ params }: { params: Promise<{ locale: string }> }) {
  const locale = normaliseLocale((await params).locale);
  const plans = await loadPlans();
  return (
    <>
      <nav className="top">
        <div className="inner">
          <strong>{t(locale, 'app.name')}</strong>
          <span style={{ flex: 1 }} />
          <LocaleSwitch />
          <Link href={`/${locale}/login`}>{t(locale, 'landing.signIn')}</Link>
        </div>
      </nav>
      <main>
        <h1>{t(locale, 'landing.title')}</h1>
        <p style={{ maxWidth: 680 }}>{t(locale, 'landing.lead')}</p>
        <h2 id="plans">{t(locale, 'landing.plans')}</h2>
        <div className="plans">
          {plans.map((p) => (
            <div className="card stack" key={p.key} data-testid={`plan-${p.key}`}>
              <h3 style={{ margin: 0 }}>{refName(p.name, locale)}</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>{t(locale, 'landing.plan.users', { n: p.max_users })}</li>
                <li>{t(locale, 'landing.plan.objects', { n: p.max_objects })}</li>
                <li>{t(locale, 'landing.plan.sms', { n: p.sms_monthly_cap })}</li>
              </ul>
              <CheckoutButton planKey={p.key} label={t(locale, 'landing.plan.choose', { name: refName(p.name, locale) })} disabled={!p.purchasable} />
            </div>
          ))}
        </div>
        <p className="muted">{t(locale, 'landing.priceInCheckout')}</p>
        <p className="banner banner-info">{t(locale, 'landing.disclaimer')}</p>
      </main>
      <Footer />
    </>
  );
}
