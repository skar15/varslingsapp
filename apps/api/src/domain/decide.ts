import { levelRank, shouldNotify, type AlertLevel } from '@varsling/shared';
import type { Ctx } from '../context';
import { many, one } from '../db/client';
import { addMinutes } from '../lib/time';
import { alertsActiveSql } from './accounts';
import { monitoredFor } from './objects';
import { loadReference } from './reference';

interface AlertRow {
  id: string;
  chain_root: string;
  msg_type: string;
  level: AlertLevel | null;
  situation_key: string | null;
  superseded_by: string | null;
}

interface CandidateObject {
  id: string;
  account_id: string;
  type_key: string | null;
  status_key: string;
  situations: { situation_key: string; sensitivity: 'low' | 'medium' | 'high' }[];
}

interface Recipient {
  id: string;
  has_device: boolean;
  sms_for_all_levels: boolean;
  phone_ok: boolean;
}

/**
 * Stage 4: objects whose geometry intersects the alert (GiST index), on accounts that are
 * receiving alerts. Objects with location_kind 'none' never match.
 */
export async function matchObjects(ctx: Ctx, alertId: string): Promise<CandidateObject[]> {
  return many<CandidateObject>(
    ctx.pool,
    `select o.id, o.account_id, o.type_key, o.status_key,
            coalesce((select json_agg(json_build_object('situation_key', s.situation_key, 'sensitivity', s.sensitivity))
                      from object_situations s where s.object_id = o.id), '[]'::json) as situations
     from objects o
     join accounts acc on acc.id = o.account_id
     where o.deleted_at is null
       and o.location_kind <> 'none'
       and ${alertsActiveSql('acc', '$2')}
       and st_intersects(o.geom, (select geom from alerts where id = $1))`,
    [alertId, ctx.env.PAST_DUE_GRACE_DAYS],
  );
}

async function recipients(ctx: Ctx, objectId: string, accountId: string): Promise<Recipient[]> {
  return many<Recipient>(
    ctx.pool,
    `select u.id, u.sms_for_all_levels,
            (u.phone_e164 is not null and u.phone_verified_at is not null) as phone_ok,
            exists (select 1 from devices d where d.user_id = u.id and d.disabled_at is null) as has_device
     from users u
     where u.account_id = $2 and u.removed_at is null
       and (not exists (select 1 from object_recipients r where r.object_id = $1)
            or exists (select 1 from object_recipients r where r.object_id = $1 and r.user_id = u.id))`,
    [objectId, accountId],
  );
}

/**
 * Stage 5: per object and recipient, create notification rows only if the level beats the
 * chain's previous notification for that user and object (first alert, or level up). A
 * same-level update or a downgrade only changes the in-app view. A Cancel or AllClear after
 * a RED notification gives one "Varsel avlyst" push. Idempotent through idempotency_key.
 */
export async function decide(ctx: Ctx, alertId: string): Promise<{ created: string[] }> {
  const alert = await one<AlertRow>(ctx.pool, 'select id, chain_root, msg_type, level, situation_key, superseded_by from alerts where id = $1', [alertId]);
  if (!alert) return { created: [] };
  // A newer message in the chain already exists (replay or out-of-order): in-app view only.
  if (alert.superseded_by) return { created: [] };
  if (alert.level === null) return decideCancel(ctx, alert);
  if (!alert.situation_key) return { created: [] };

  const ref = await loadReference(ctx.pool);
  const created: string[] = [];
  for (const obj of await matchObjects(ctx, alertId)) {
    const set = monitoredFor(ref, obj);
    if (!shouldNotify(set, alert.situation_key, alert.level)) continue;
    for (const user of await recipients(ctx, obj.id, obj.account_id)) {
      const prev = await one<{ level: AlertLevel | null }>(
        ctx.pool,
        `select max(level) as level from notifications where chain_root = $1 and object_id = $2 and user_id = $3 and kind = 'alert'`,
        [alert.chain_root, obj.id, user.id],
      );
      if (levelRank(alert.level) <= levelRank(prev?.level)) continue;
      const channels: ('push' | 'sms')[] = [];
      if (user.has_device) channels.push('push');
      if (user.phone_ok && (alert.level === 'red' || user.sms_for_all_levels || !user.has_device)) channels.push('sms');
      if (!channels.length) {
        ctx.log.warn({ metric: 'notification_no_channel', userId: user.id, alertId }, 'recipient has no push device and no verified phone');
        continue;
      }
      const ids: string[] = [];
      for (const channel of channels) {
        const row = await one<{ id: string }>(
          ctx.pool,
          `insert into notifications(alert_id, object_id, user_id, kind, chain_root, level, channel, idempotency_key)
           values ($1,$2,$3,'alert',$4,$5,$6,$7) on conflict (idempotency_key) do nothing returning id`,
          [alert.id, obj.id, user.id, alert.chain_root, alert.level, channel, `${alert.chain_root}|${obj.id}|${user.id}|${channel}|${alert.level}`],
        );
        if (row) ids.push(row.id);
      }
      for (const id of ids) await ctx.jobs.send('notify.dispatch', { notificationId: id });
      // Stage 7: one reminder 15 minutes after a RED notification if not acknowledged.
      if (alert.level === 'red' && ids[0]) {
        await ctx.jobs.send('notify.reminder', { notificationId: ids[0] }, { startAfter: addMinutes(ctx.now(), ctx.env.REMINDER_DELAY_MINUTES) });
      }
      created.push(...ids);
    }
  }
  return { created };
}

async function decideCancel(ctx: Ctx, alert: AlertRow): Promise<{ created: string[] }> {
  const targets = await many<{ object_id: string; user_id: string; has_device: boolean }>(
    ctx.pool,
    `select distinct n.object_id, n.user_id,
            exists (select 1 from devices d where d.user_id = n.user_id and d.disabled_at is null) as has_device
     from notifications n
     join users u on u.id = n.user_id and u.removed_at is null
     join objects o on o.id = n.object_id and o.deleted_at is null
     where n.chain_root = $1 and n.kind = 'alert' and n.level = 'red'`,
    [alert.chain_root],
  );
  const created: string[] = [];
  for (const t of targets) {
    if (!t.has_device) continue; // cancel goes by push only
    const row = await one<{ id: string }>(
      ctx.pool,
      `insert into notifications(alert_id, object_id, user_id, kind, chain_root, level, channel, idempotency_key)
       values ($1,$2,$3,'cancel',$4,'red','push',$5) on conflict (idempotency_key) do nothing returning id`,
      [alert.id, t.object_id, t.user_id, alert.chain_root, `${alert.chain_root}|${t.object_id}|${t.user_id}|push|cancel`],
    );
    if (row) {
      created.push(row.id);
      await ctx.jobs.send('notify.dispatch', { notificationId: row.id });
    }
  }
  return { created };
}
