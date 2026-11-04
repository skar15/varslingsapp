import type { Providers } from '../context';
import type { Env } from '../env';
import type { Logger } from '../lib/logger';
import { FakeAuthAdmin, SupabaseAuthAdmin, SupabaseJwtVerifier } from './auth';
import { FakeEmailProvider, ResendEmailProvider } from './email';
import { FakeGeocoder, KartverketGeocoder } from './geocoder';
import { FakeHeartbeat, HttpHeartbeat } from './heartbeat';
import { FakePaymentProvider, StripePaymentProvider } from './payment';
import { ExpoPushProvider, FakePushProvider } from './push';
import { FakeSmsProvider, TwilioSmsProvider } from './sms';

/**
 * Real providers when configured; otherwise logging fakes, so development works without
 * credentials. Production refuses to start without the real ones (env.ts).
 */
export function createProviders(env: Env, log: Logger): Providers {
  const warnFake = (name: string) => log.warn({ provider: name }, `using fake ${name} provider (not configured)`);

  const push = env.APP_ENV === 'test' ? new FakePushProvider() : new ExpoPushProvider(env.EXPO_ACCESS_TOKEN);

  let sms;
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) sms = new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.SMS_SENDER_ID ?? 'Varsling');
  else (warnFake('sms'), (sms = new FakeSmsProvider()));

  let payment;
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) payment = new StripePaymentProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  else (warnFake('payment'), (payment = new FakePaymentProvider()));

  let email;
  if (env.RESEND_API_KEY && env.EMAIL_FROM) email = new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  else (warnFake('email'), (email = new FakeEmailProvider()));

  let authAdmin;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) authAdmin = new SupabaseAuthAdmin(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  else (warnFake('auth-admin'), (authAdmin = new FakeAuthAdmin()));

  const authVerifier = new SupabaseJwtVerifier({ supabaseUrl: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET ?? (env.SUPABASE_URL ? undefined : 'dev-only-jwt-secret') });

  return {
    push,
    sms,
    payment,
    email,
    authAdmin,
    authVerifier,
    geocoder: env.APP_ENV === 'test' ? new FakeGeocoder() : new KartverketGeocoder(),
    heartbeat: env.HEARTBEAT_URL ? new HttpHeartbeat(env.HEARTBEAT_URL) : new FakeHeartbeat(),
  };
}
