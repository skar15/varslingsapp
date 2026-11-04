import type { Pool } from './db/client';
import type { Env } from './env';
import type { JobQueue } from './jobs/types';
import type { Logger } from './lib/logger';
import type { AuthAdmin, AuthVerifier } from './providers/auth';
import type { EmailProvider } from './providers/email';
import type { Geocoder } from './providers/geocoder';
import type { Heartbeat } from './providers/heartbeat';
import type { PaymentProvider } from './providers/payment';
import type { PushProvider } from './providers/push';
import type { SmsProvider } from './providers/sms';
import type { AlertSource } from './sources/types';

export interface Providers {
  push: PushProvider;
  sms: SmsProvider;
  payment: PaymentProvider;
  geocoder: Geocoder;
  email: EmailProvider;
  authVerifier: AuthVerifier;
  authAdmin: AuthAdmin;
  heartbeat: Heartbeat;
}

/** Everything the domain needs. Built once in server.ts / worker.ts and by tests with fakes. */
export interface Ctx {
  pool: Pool;
  env: Env;
  providers: Providers;
  jobs: JobQueue;
  sources: AlertSource[];
  log: Logger;
  now: () => Date;
  /** Reports an operational problem to Sentry (or the log in dev). */
  opsAlert: (message: string, extra?: Record<string, unknown>) => void;
}
