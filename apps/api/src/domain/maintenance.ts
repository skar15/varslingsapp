import type { Ctx } from '../context';
import { many } from '../db/client';
import { audit } from '../lib/audit';

/** Retention: notifications 13 months, audit log 24 months (configurable). */
export async function runRetention(ctx: Ctx): Promise<Record<string, number>> {
  const months = ctx.env.NOTIFICATION_RETENTION_MONTHS;
  const n = await ctx.pool.query(`delete from notifications where queued_at < now() - make_interval(months => $1)`, [months]);
  const a = await ctx.pool.query(`delete from audit_log where at < now() - make_interval(months => $1)`, [ctx.env.AUDIT_RETENTION_MONTHS]);
  const r = await ctx.pool.query(`delete from ingest_runs where started_at < now() - interval '90 days'`);
  const i = await ctx.pool.query(`delete from invitations where (accepted_at is not null or expires_at < now() - interval '30 days') and created_at < now() - interval '30 days'`);
  const t = await ctx.pool.query(`delete from push_tickets where created_at < now() - interval '30 days'`);
  const res = { notifications: n.rowCount ?? 0, audit_log: a.rowCount ?? 0, ingest_runs: r.rowCount ?? 0, invitations: i.rowCount ?? 0, push_tickets: t.rowCount ?? 0 };
  ctx.log.info({ retention: res }, 'retention run');
  return res;
}

/**
 * Erasure after a deletion request (schema rule 4): personal data (names, phone numbers,
 * emails, locations, device tokens) is removed; only anonymised rows and counts remain.
 * Runs daily, so erasure completes well within the 30 days promised.
 */
export async function runErasure(ctx: Ctx): Promise<number> {
  const accounts = await many<{ id: string }>(ctx.pool, `select id from accounts where deleted_at is not null and erased_at is null`);
  for (const { id } of accounts) {
    const client = await ctx.pool.connect();
    try {
      await client.query('begin');
      await client.query(`delete from push_tickets where device_id in (select d.id from devices d join users u on u.id = d.user_id where u.account_id = $1)`, [id]);
      await client.query(`delete from devices where user_id in (select id from users where account_id = $1)`, [id]);
      await client.query(`delete from invitations where account_id = $1`, [id]);
      await client.query(`delete from change_proposals where account_id = $1`, [id]);
      await client.query(`delete from object_recipients where object_id in (select id from objects where account_id = $1)`, [id]);
      await client.query(`delete from object_situations where object_id in (select id from objects where account_id = $1)`, [id]);
      await client.query(
        `update objects set nickname = null, place_label = null, geom = null, location_kind = 'none', county_no = null,
           deleted_at = coalesce(deleted_at, now()) where account_id = $1`,
        [id],
      );
      await client.query(
        `update users set name = 'slettet', email = null, phone_e164 = null, phone_verified_at = null, removed_at = coalesce(removed_at, now()) where account_id = $1`,
        [id],
      );
      await client.query(
        `update accounts set legal_name = null, org_number = null, claim_email = null, claim_token_hash = null, erased_at = now() where id = $1`,
        [id],
      );
      await client.query(`update audit_log set metadata = '{}' where account_id = $1`, [id]);
      await audit(client, { accountId: id, actorId: null, action: 'account.erased', targetType: 'account', targetId: id });
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      ctx.log.error({ accountId: id, err: (err as Error).message }, 'erasure failed');
    } finally {
      client.release();
    }
  }
  return accounts.length;
}
