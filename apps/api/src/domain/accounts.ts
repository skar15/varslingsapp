import type { schemas } from '@varsling/shared';
import type { z } from 'zod';
import { one, type Db } from '../db/client';
import type { Env } from '../env';
import { notFound } from '../lib/errors';
import { osloMonth } from '../lib/time';

export interface AccountRow {
  id: string;
  kind: 'person' | 'company' | 'public_body';
  legal_name: string | null;
  org_number: string | null;
  plan_key: string | null;
  status: 'pending_profile' | 'active' | 'past_due' | 'canceled' | 'deleted';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  past_due_since: Date | null;
  sms_cap_warned_month: string | null;
}

export interface PlanRow {
  key: string;
  name: string;
  i18n: { nb: string; en?: string };
  max_users: number;
  max_objects: number;
  sms_monthly_cap: number;
  stripe_price_id: string | null;
}

/** SQL predicate: alerts are delivered for this account (past_due pauses after the grace period). */
export function alertsActiveSql(alias: string, graceParam: string): string {
  return `(${alias}.status = 'active' or (${alias}.status = 'past_due' and ${alias}.past_due_since > now() - make_interval(days => ${graceParam})))`;
}

export function alertsPaused(account: Pick<AccountRow, 'status' | 'past_due_since'>, env: Env, now: Date): boolean {
  if (account.status === 'active') return false;
  if (account.status === 'past_due' && account.past_due_since) {
    return now.getTime() - account.past_due_since.getTime() > env.PAST_DUE_GRACE_DAYS * 86_400_000;
  }
  return true;
}

export async function getAccount(db: Db, id: string, forUpdate = false): Promise<AccountRow> {
  const a = await one<AccountRow>(db, `select * from accounts where id = $1 and deleted_at is null${forUpdate ? ' for update' : ''}`, [id]);
  if (!a) throw notFound('account');
  return a;
}

export async function getPlan(db: Db, key: string | null): Promise<PlanRow | null> {
  if (!key) return null;
  return (await one<PlanRow>(db, 'select key, name, i18n, max_users, max_objects, sms_monthly_cap, stripe_price_id from plans where key = $1', [key])) ?? null;
}

export function planDto(p: PlanRow): z.infer<typeof schemas.Plan> {
  return { key: p.key, name: p.i18n?.nb ? p.i18n : { nb: p.name }, max_users: p.max_users, max_objects: p.max_objects, sms_monthly_cap: p.sms_monthly_cap, purchasable: !!p.stripe_price_id };
}

export interface Usage {
  users: number;
  pending_invitations: number;
  objects: number;
  sms_this_month: number;
}

export async function usage(db: Db, accountId: string, now: Date): Promise<Usage> {
  const r = await one<Usage>(
    db,
    `select
       (select count(*)::int from users where account_id = $1 and removed_at is null) as users,
       (select count(*)::int from invitations where account_id = $1 and accepted_at is null and revoked_at is null and expires_at > $2) as pending_invitations,
       (select count(*)::int from objects where account_id = $1 and deleted_at is null) as objects,
       coalesce((select count from sms_usage where account_id = $1 and month = $3), 0)::int as sms_this_month`,
    [accountId, now, osloMonth(now)],
  );
  return r!;
}
