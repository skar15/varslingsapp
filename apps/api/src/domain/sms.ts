import type { Ctx } from '../context';
import { one, withTx } from '../db/client';
import { osloMonth } from '../lib/time';

export type SmsOutcome = { sent: true; id: string } | { sent: false; reason: 'cap' | 'hard_ceiling' | 'no_plan' };

/**
 * Sends one SMS under the account's monthly cap. At 80 % the owner is told once per month.
 * Beyond the cap only RED alerts still go, up to a hard ceiling of three times the cap,
 * which also raises an ops alert (guard against SMS pumping).
 */
export async function sendSmsWithCap(ctx: Ctx, p: { accountId: string; to: string; body: string; red: boolean }): Promise<SmsOutcome> {
  const month = osloMonth(ctx.now());
  const decision = await withTx(ctx.pool, async (db) => {
    const plan = await one<{ cap: number; warned: string | null }>(
      db,
      `select p.sms_monthly_cap as cap, a.sms_cap_warned_month as warned from accounts a join plans p on p.key = a.plan_key where a.id = $1 for update of a`,
      [p.accountId],
    );
    if (!plan) return { ok: false as const, reason: 'no_plan' as const };
    await db.query('insert into sms_usage(account_id, month, count) values ($1,$2,0) on conflict do nothing', [p.accountId, month]);
    const usage = await one<{ count: number }>(db, 'select count from sms_usage where account_id = $1 and month = $2 for update', [p.accountId, month]);
    const count = usage!.count;
    if (count >= plan.cap * 3) return { ok: false as const, reason: 'hard_ceiling' as const };
    if (count >= plan.cap && !p.red) return { ok: false as const, reason: 'cap' as const };
    await db.query('update sms_usage set count = count + 1 where account_id = $1 and month = $2', [p.accountId, month]);
    const after = count + 1;
    let warn = false;
    if (after >= Math.ceil(plan.cap * 0.8) && plan.warned !== month) {
      await db.query('update accounts set sms_cap_warned_month = $2 where id = $1', [p.accountId, month]);
      warn = true;
    }
    return { ok: true as const, warn, ceilingReached: after >= plan.cap * 3 };
  });
  if (!decision.ok) {
    if (decision.reason === 'hard_ceiling') ctx.opsAlert('sms hard ceiling reached', { accountId: p.accountId });
    ctx.log.warn({ metric: 'sms_suppressed', reason: decision.reason, accountId: p.accountId }, 'sms suppressed');
    return { sent: false, reason: decision.reason };
  }
  if (decision.warn) {
    const owner = await one<{ id: string }>(ctx.pool, "select id from users where account_id = $1 and role = 'owner' and removed_at is null", [p.accountId]);
    if (owner) await ctx.jobs.send('info.push', { userIds: [owner.id], bodyKey: 'msg.smsCapWarning' });
  }
  if (decision.ceilingReached) ctx.opsAlert('sms hard ceiling reached', { accountId: p.accountId });
  const res = await ctx.providers.sms.send(p.to, p.body, { statusCallbackUrl: `${ctx.env.API_PUBLIC_URL}/v1/webhooks/sms` });
  return { sent: true, id: res.id };
}
