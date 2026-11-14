import { z } from 'zod';

const bool = z.preprocess((v) => (typeof v === 'string' ? ['1', 'true', 'yes'].includes(v.toLowerCase()) : v), z.boolean());

export const EnvSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/varsling'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /** Legacy HS256 JWT secret. When unset, tokens are verified against the project's JWKS. */
  SUPABASE_JWT_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  /** Required for every MET request. Supplied by the project owner, never invented (rule 10). */
  MET_USER_AGENT: z.string().optional(),
  MET_POLL_INTERVAL_SEC: z.coerce.number().int().min(600).default(600),
  NVE_POLL_INTERVAL_SEC: z.coerce.number().int().min(60).default(600),
  NVE_ENABLED: bool.default(true),
  MET_ALERTS_URL: z.string().default('https://api.met.no/weatherapi/metalerts/2.0/current.rss'),
  NVE_FLOOD_BASE_URL: z.string().default('https://api01.nve.no/hydrology/forecast/flood/v1.0.5/api'),
  NVE_LANDSLIDE_BASE_URL: z.string().default('https://api01.nve.no/hydrology/forecast/landslide/v1.0.6/api'),
  LIGHT_HORIZON_HOURS: z.coerce.number().int().default(72),
  STATUS_EXTENSION_GRACE_MINUTES: z.coerce.number().int().default(120),
  PAST_DUE_GRACE_DAYS: z.coerce.number().int().default(7),
  MAX_AREA_KM2: z.coerce.number().default(2500),
  NOTIFICATION_RETENTION_MONTHS: z.coerce.number().int().default(13),
  AUDIT_RETENTION_MONTHS: z.coerce.number().int().default(24),
  REMINDER_DELAY_MINUTES: z.coerce.number().int().default(15),
  STALE_INGEST_MINUTES: z.coerce.number().int().default(30),
  HEARTBEAT_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  ADMIN_API_KEY: z.string().optional(),
  /** Encrypts the claim token inside Stripe checkout metadata (see docs/decisions/004). */
  CLAIM_TOKEN_SECRET: z.string().min(32).default('dev-only-claim-token-secret-change-me-please'),
  WEB_URL: z.string().default('http://localhost:3000'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // `.env.example` ships empty placeholders (e.g. `CLAIM_TOKEN_SECRET=`). Treat empty or
  // whitespace-only values as unset so the schema defaults apply instead of failing validation.
  const withoutBlanks = Object.fromEntries(
    Object.entries(source).filter(([, v]) => typeof v !== 'string' || v.trim() !== ''),
  );
  const env = EnvSchema.parse(withoutBlanks);
  if (env.APP_ENV === 'production') {
    const required = ['SUPABASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'MET_USER_AGENT', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] as const;
    const missing = required.filter((k) => !env[k]);
    if (missing.length) throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
    if (env.CLAIM_TOKEN_SECRET.startsWith('dev-only')) throw new Error('CLAIM_TOKEN_SECRET must be set in production');
  }
  return env;
}
