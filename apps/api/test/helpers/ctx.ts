import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import type { Ctx } from '../../src/context';
import { createPool, one, type Pool } from '../../src/db/client';
import { clearReferenceCache } from '../../src/domain/reference';
import { EnvSchema, type Env } from '../../src/env';
import { buildApp } from '../../src/http/app';
import { createHandlers } from '../../src/jobs/handlers';
import { FakeQueue } from '../../src/jobs/queue';
import type { JobHandlers } from '../../src/jobs/types';
import { createLogger } from '../../src/lib/logger';
import { FakeAuthAdmin, signTestToken, SupabaseJwtVerifier } from '../../src/providers/auth';
import { FakeEmailProvider } from '../../src/providers/email';
import { FakeGeocoder } from '../../src/providers/geocoder';
import { FakeHeartbeat } from '../../src/providers/heartbeat';
import { FakePaymentProvider } from '../../src/providers/payment';
import { FakePushProvider } from '../../src/providers/push';
import { FakeSmsProvider } from '../../src/providers/sms';
import type { AlertSource } from '../../src/sources/types';

export const JWT_SECRET = 'test-jwt-secret-test-jwt-secret-1234';

export interface TestCtx extends Ctx {
  jobs: FakeQueue;
  fakes: {
    push: FakePushProvider;
    sms: FakeSmsProvider;
    payment: FakePaymentProvider;
    email: FakeEmailProvider;
    authAdmin: FakeAuthAdmin;
    heartbeat: FakeHeartbeat;
  };
  clock: { now: Date };
  opsAlerts: string[];
  handlers: JobHandlers;
  /** Runs immediate jobs; pass `until` to also run delayed jobs due by then. */
  drain: (opts?: { until?: Date }) => Promise<number>;
}

let sharedPool: Pool | undefined;
export function pool(): Pool {
  sharedPool ??= createPool(inject('databaseUrl'), 5);
  return sharedPool;
}

export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return EnvSchema.parse({
    APP_ENV: 'test', DATABASE_URL: inject('databaseUrl'), SUPABASE_JWT_SECRET: JWT_SECRET, ADMIN_API_KEY: 'admin-test-key',
    MET_USER_AGENT: 'varslingsapp-test/1.0 test@example.invalid', WEB_URL: 'https://app.test', API_PUBLIC_URL: 'https://api.test', LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export function makeCtx(opts: { env?: Env; sources?: AlertSource[] } = {}): TestCtx {
  const env = opts.env ?? testEnv();
  const clock = { now: new Date('2026-11-05T08:00:00Z') };
  const fakes = {
    push: new FakePushProvider(), sms: new FakeSmsProvider(), payment: new FakePaymentProvider(), email: new FakeEmailProvider(),
    authAdmin: new FakeAuthAdmin(), heartbeat: new FakeHeartbeat(),
  };
  const opsAlerts: string[] = [];
  const jobs = new FakeQueue();
  const ctx = {
    env, pool: pool(), jobs, sources: opts.sources ?? [], log: createLogger('silent'), now: () => clock.now,
    opsAlert: (m: string) => opsAlerts.push(m),
    providers: { ...fakes, geocoder: new FakeGeocoder(), authVerifier: new SupabaseJwtVerifier({ jwtSecret: JWT_SECRET }) },
    fakes, clock, opsAlerts,
  } as unknown as TestCtx;
  ctx.handlers = createHandlers(ctx);
  ctx.drain = (o = {}) => jobs.drain(ctx.handlers, o);
  return ctx;
}

const DATA_TABLES = [
  'push_tickets', 'notifications', 'alerts', 'source_alerts', 'change_proposals', 'audit_log', 'object_recipients', 'object_situations',
  'objects', 'devices', 'invitations', 'sms_usage', 'users', 'accounts', 'processed_webhooks', 'ingest_runs', 'source_state',
];

export async function resetDb(): Promise<void> {
  clearReferenceCache();
  await pool().query(`truncate ${DATA_TABLES.join(', ')} restart identity cascade`);
  await pool().query(`update plans set stripe_price_id = 'price_' || key`);
}

export interface TestUser {
  id: string;
  token: string;
  accountId: string;
}

let phoneSeq = 10000000;
export async function createAccount(ctx: TestCtx, opts: { plan?: string; status?: string; ownerName?: string; phone?: boolean } = {}): Promise<{ accountId: string; owner: TestUser }> {
  const acc = await one<{ id: string }>(
    ctx.pool,
    `insert into accounts(kind, legal_name, plan_key, status, stripe_customer_id, stripe_subscription_id) values ('person', $1, $2, $3, $4, $5) returning id`,
    [opts.ownerName ?? 'Owner', opts.plan ?? 'familie', opts.status ?? 'active', `cus_${randomUUID()}`, `sub_${randomUUID()}`],
  );
  const owner = await addUser(ctx, acc!.id, { role: 'owner', name: opts.ownerName ?? 'Eier', phone: opts.phone ?? true });
  return { accountId: acc!.id, owner };
}

export async function addUser(
  ctx: TestCtx, accountId: string,
  opts: { role?: 'owner' | 'member'; delegate?: boolean; name?: string; phone?: boolean; device?: boolean; smsAll?: boolean; locale?: 'nb' | 'en' } = {},
): Promise<TestUser> {
  const id = randomUUID();
  const phone = opts.phone === false ? null : `+479${String(++phoneSeq).slice(-7)}`;
  await ctx.pool.query(
    `insert into users(id, account_id, role, can_manage_objects, name, email, phone_e164, phone_verified_at, sms_for_all_levels, locale)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, accountId, opts.role ?? 'member', opts.delegate ?? false, opts.name ?? 'Bruker', `${id.slice(0, 8)}@example.invalid`, phone, phone ? new Date() : null, opts.smsAll ?? false, opts.locale ?? 'nb'],
  );
  if (opts.device !== false) {
    await ctx.pool.query(`insert into devices(user_id, platform, push_token) values ($1, 'ios', $2)`, [id, `ExponentPushToken[${id}]`]);
  }
  return { id, accountId, token: await signTestToken(JWT_SECRET, { sub: id }) };
}

export async function app(ctx: TestCtx): Promise<FastifyInstance> {
  const a = await buildApp(ctx, { logger: false });
  await a.ready();
  return a;
}

export function call(a: FastifyInstance, user: TestUser | string | null) {
  const token = typeof user === 'string' ? user : user?.token;
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return {
    get: (url: string) => a.inject({ method: 'GET', url, headers }),
    post: (url: string, body?: unknown) => a.inject({ method: 'POST', url, headers, payload: body as object }),
    patch: (url: string, body?: unknown) => a.inject({ method: 'PATCH', url, headers, payload: body as object }),
    put: (url: string, body?: unknown) => a.inject({ method: 'PUT', url, headers, payload: body as object }),
    delete: (url: string) => a.inject({ method: 'DELETE', url, headers }),
  };
}

/** Square polygon around a point, ~size degrees wide. GeoJSON order. */
export function boxAround(lon: number, lat: number, d = 0.1): [number, number][] {
  return [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]];
}

export const PLACES = {
  bjornvika: [16.9946, 68.6806] as [number, number], // Stræte, Grovfjord, Troms
  andenes: [16.1194, 69.3143] as [number, number],
  oslo: [10.7522, 59.9139] as [number, number],
};
