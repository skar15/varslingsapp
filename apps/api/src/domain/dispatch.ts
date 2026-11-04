import { cancelMessage, objectDisplayName, pushAlertMessage, reminderMessage, smsAlertMessage, toGsm7, type AlertLevel, type Locale } from '@varsling/shared';
import type { Ctx } from '../context';
import { many, one, withTx } from '../db/client';
import type { PushChannelId, PushMessage } from '../providers/push';
import { disableUnregistered } from './info';
import { alertTitle } from './objects';
import { loadReference, situationName, typeName } from './reference';
import { sendSmsWithCap } from './sms';

interface NotificationJoin {
  id: string;
  alert_id: string;
  object_id: string;
  user_id: string;
  account_id: string;
  kind: 'alert' | 'cancel';
  chain_root: string;
  level: AlertLevel;
  channel: 'push' | 'sms';
  state: string;
  locale: Locale;
  phone_e164: string | null;
  phone_verified_at: Date | null;
  nickname: string | null;
  type_key: string | null;
  place_label: string | null;
  situation_key: string | null;
  title_nb: string | null;
  title_en: string | null;
  onset: Date | null;
  expires: Date;
}

const LOAD = `
  select n.id, n.alert_id, n.object_id, n.user_id, o.account_id, n.kind, n.chain_root, n.level, n.channel, n.state,
         u.locale, u.phone_e164, u.phone_verified_at, o.nickname, o.type_key, o.place_label,
         a.situation_key, a.title_nb, a.title_en, a.onset, a.expires
  from notifications n
  join users u on u.id = n.user_id
  join objects o on o.id = n.object_id
  join alerts a on a.id = n.alert_id`;

function channelFor(level: AlertLevel, kind: 'alert' | 'cancel'): PushChannelId {
  if (kind === 'cancel') return 'alert-info';
  return level === 'red' ? 'alert-red' : 'alert-yellow';
}

/** Critical alerts are used only when Apple grants the entitlement (env flag). */
const CRITICAL_ENABLED = process.env.IOS_CRITICAL_ALERTS === 'true';

async function context(ctx: Ctx, n: NotificationJoin) {
  const ref = await loadReference(ctx.pool);
  const objectName = objectDisplayName(n.nickname, typeName(ref, n.type_key, n.locale), n.place_label, n.locale === 'en' ? 'Object' : 'Objekt');
  return { objectName, situation: situationName(ref, n.situation_key, n.locale), link: `${ctx.env.WEB_URL}/alerts/${n.alert_id}` };
}

/**
 * Stage 6: one job per notification row. Row locking (skip locked) means two workers never
 * send the same notification; the state check makes retries safe.
 */
export async function dispatchNotification(ctx: Ctx, notificationId: string, meta: { retryCount: number; retryLimit: number } = { retryCount: 0, retryLimit: 1 }): Promise<void> {
  const client = await ctx.pool.connect();
  let n: NotificationJoin | undefined;
  try {
    await client.query('begin');
    n = await one<NotificationJoin>(client, `${LOAD} where n.id = $1 and n.state = 'queued' for update of n skip locked`, [notificationId]);
    if (!n) {
      await client.query('commit');
      return;
    }
    const c = await context(ctx, n);
    if (n.channel === 'push') await sendPush(ctx, client, n, c);
    else await sendSms(ctx, client, n, c);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    const final = meta.retryCount + 1 >= meta.retryLimit;
    if (final && n) {
      await ctx.pool.query("update notifications set state = 'failed', error = $2 where id = $1 and state = 'queued'", [notificationId, (err as Error).message.slice(0, 500)]);
      ctx.log.error({ metric: 'notification_failed', notificationId, channel: n.channel }, 'notification failed');
      if (n.channel === 'push') await smsFallback(ctx, n);
    }
    throw err;
  } finally {
    client.release();
  }
}

async function sendPush(ctx: Ctx, db: import('../db/client').PoolClient, n: NotificationJoin, c: { objectName: string; situation: string; link: string }) {
  const devices = await many<{ id: string; push_token: string }>(db, 'select id, push_token from devices where user_id = $1 and disabled_at is null', [n.user_id]);
  if (!devices.length) {
    await db.query("update notifications set state = 'failed', error = 'no enabled device' where id = $1", [n.id]);
    await smsFallback(ctx, n);
    return;
  }
  const { title, body } =
    n.kind === 'cancel'
      ? { title: cancelMessage(n.locale, c.situation, c.objectName), body: '' }
      : pushAlertMessage({
          locale: n.locale, level: n.level, situationName: c.situation, objectName: c.objectName,
          headline: alertTitle(n, n.locale) ?? c.situation, onset: n.onset, expires: n.expires, link: c.link,
        });
  const messages: PushMessage[] = devices.map((d) => ({
    to: d.push_token,
    title,
    body,
    data: { notification_id: n.id, alert_id: n.alert_id, object_id: n.object_id, kind: n.kind, level: n.level, url: `varsling://alerts/${n.alert_id}` },
    channelId: channelFor(n.level, n.kind),
    categoryId: n.kind === 'alert' ? 'alert' : undefined,
    interruptionLevel: n.kind === 'alert' ? (n.level === 'red' && CRITICAL_ENABLED ? 'critical' : 'time-sensitive') : 'active',
    critical: n.kind === 'alert' && n.level === 'red' && CRITICAL_ENABLED,
    priority: n.kind === 'alert' ? 'high' : 'default',
  }));
  const tickets = await ctx.providers.push.send(messages);
  for (let i = 0; i < devices.length; i++) {
    const t = tickets[i];
    await db.query('insert into push_tickets(notification_id, device_id, ticket_id, status, error) values ($1,$2,$3,$4,$5)', [
      n.id, devices[i]!.id, t?.id ?? null, t?.ok ? 'ok' : 'error', t?.error ?? null,
    ]);
  }
  await disableUnregistered(ctx, devices.map((d) => d.push_token), tickets);
  const okTicket = tickets.find((t) => t.ok);
  if (okTicket) {
    await db.query("update notifications set state = 'sent', sent_at = now(), provider_message_id = $2 where id = $1", [n.id, okTicket.id]);
  } else {
    await db.query("update notifications set state = 'failed', error = $2 where id = $1", [n.id, tickets[0]?.error ?? 'push rejected']);
    await smsFallback(ctx, n);
  }
}

async function sendSms(ctx: Ctx, db: import('../db/client').PoolClient, n: NotificationJoin, c: { objectName: string; situation: string; link: string }) {
  if (!n.phone_e164 || !n.phone_verified_at) {
    await db.query("update notifications set state = 'suppressed', error = 'no verified phone' where id = $1", [n.id]);
    return;
  }
  const body = smsAlertMessage({
    locale: n.locale, level: n.level, situationName: c.situation, objectName: c.objectName, headline: '', onset: n.onset, expires: n.expires, link: c.link,
  });
  const res = await sendSmsWithCap(ctx, { accountId: n.account_id, to: n.phone_e164, body, red: n.level === 'red' });
  if (res.sent) await db.query("update notifications set state = 'sent', sent_at = now(), provider_message_id = $2 where id = $1", [n.id, res.id]);
  else await db.query("update notifications set state = 'suppressed', error = $2 where id = $1", [n.id, `sms ${res.reason}`]);
}

/** A user whose push failed gets the SMS fallback (no working push token), except for cancels. */
async function smsFallback(ctx: Ctx, n: NotificationJoin) {
  if (n.kind !== 'alert' || !n.phone_e164 || !n.phone_verified_at) return;
  const row = await one<{ id: string }>(
    ctx.pool,
    `insert into notifications(alert_id, object_id, user_id, kind, chain_root, level, channel, idempotency_key)
     values ($1,$2,$3,'alert',$4,$5,'sms',$6) on conflict (idempotency_key) do nothing returning id`,
    [n.alert_id, n.object_id, n.user_id, n.chain_root, n.level, `${n.chain_root}|${n.object_id}|${n.user_id}|sms|${n.level}`],
  );
  if (row) await ctx.jobs.send('notify.dispatch', { notificationId: row.id });
}

/** Stage 7: one reminder by push and SMS if a RED notification is still unacknowledged. */
export async function sendReminder(ctx: Ctx, notificationId: string): Promise<boolean> {
  const n = await one<NotificationJoin>(ctx.pool, `${LOAD} where n.id = $1`, [notificationId]);
  if (!n) return false;
  const status = await one<{ acked: boolean; reminded: boolean; removed: boolean }>(
    ctx.pool,
    `select bool_or(acked_at is not null) as acked, bool_or(reminder_sent_at is not null) as reminded,
            (select removed_at is not null from users where id = $3) as removed
     from notifications where chain_root = $1 and object_id = $2 and user_id = $3 and kind = 'alert'`,
    [n.chain_root, n.object_id, n.user_id],
  );
  if (!status || status.acked || status.reminded || status.removed) return false;
  const c = await context(ctx, n);
  const text = reminderMessage(n.locale, c.objectName);
  const devices = await many<{ push_token: string }>(ctx.pool, 'select push_token from devices where user_id = $1 and disabled_at is null', [n.user_id]);
  if (devices.length) {
    const tickets = await ctx.providers.push.send(
      devices.map((d) => ({
        to: d.push_token, title: text, body: '', channelId: 'alert-red' as const, categoryId: 'alert' as const, priority: 'high' as const,
        interruptionLevel: 'time-sensitive' as const,
        data: { notification_id: n.id, alert_id: n.alert_id, object_id: n.object_id, kind: 'reminder', level: n.level, url: `varsling://alerts/${n.alert_id}` },
      })),
    );
    await disableUnregistered(ctx, devices.map((d) => d.push_token), tickets);
  }
  if (n.phone_e164 && n.phone_verified_at) {
    await sendSmsWithCap(ctx, { accountId: n.account_id, to: n.phone_e164, body: toGsm7(`${text}. ${c.link}`), red: true });
  }
  await ctx.pool.query('update notifications set reminder_sent_at = now() where alert_id = $1 and object_id = $2 and user_id = $3', [n.alert_id, n.object_id, n.user_id]);
  return true;
}

/** "Mottatt": acknowledges every channel of the notification for this alert, object and user. */
export async function acknowledge(ctx: Ctx, userId: string, notificationId: string): Promise<Date | null> {
  return withTx(ctx.pool, async (db) => {
    const n = await one<{ alert_id: string; object_id: string; acked_at: Date | null }>(
      db, 'select alert_id, object_id, acked_at from notifications where id = $1 and user_id = $2', [notificationId, userId],
    );
    if (!n) return null;
    if (n.acked_at) return n.acked_at;
    const r = await one<{ acked_at: Date }>(
      db,
      `update notifications set acked_at = now(), state = case when state in ('sent','delivered','queued') then 'acked'::notif_state else state end
       where alert_id = $1 and object_id = $2 and user_id = $3 and acked_at is null returning acked_at`,
      [n.alert_id, n.object_id, userId],
    );
    return r?.acked_at ?? new Date();
  });
}

/** Expo receipts about 15 minutes after sending. DeviceNotRegistered disables the device. */
export async function checkReceipts(ctx: Ctx): Promise<number> {
  const tickets = await many<{ id: number; ticket_id: string; device_id: string; notification_id: string | null }>(
    ctx.pool,
    `select id, ticket_id, device_id, notification_id from push_tickets
     where checked_at is null and ticket_id is not null and created_at < $1 order by created_at limit 1000`,
    [new Date(ctx.now().getTime() - 15 * 60_000)],
  );
  if (!tickets.length) return 0;
  const receipts = await ctx.providers.push.receipts(tickets.map((t) => t.ticket_id));
  const byId = new Map(receipts.map((r) => [r.id, r]));
  for (const t of tickets) {
    const r = byId.get(t.ticket_id);
    if (!r) continue; // not ready yet
    await ctx.pool.query('update push_tickets set checked_at = now(), receipt_status = $2, error = $3 where id = $1', [t.id, r.ok ? 'ok' : 'error', r.error ?? null]);
    if (r.error === 'DeviceNotRegistered') await ctx.pool.query('update devices set disabled_at = now() where id = $1 and disabled_at is null', [t.device_id]);
    if (r.ok && t.notification_id) {
      await ctx.pool.query("update notifications set state = 'delivered', delivered_at = now() where id = $1 and state = 'sent'", [t.notification_id]);
    }
  }
  const failed = receipts.filter((r) => !r.ok).length;
  if (receipts.length >= 20 && failed / receipts.length > 0.2) ctx.opsAlert('push receipt failure rate high', { failed, total: receipts.length });
  return receipts.length;
}

/** Delivery-report webhook from the SMS provider. */
export async function smsDeliveryReport(ctx: Ctx, report: { id: string; state: 'sent' | 'delivered' | 'failed'; error?: string }): Promise<void> {
  if (report.state === 'delivered') {
    await ctx.pool.query("update notifications set state = case when state = 'acked' then state else 'delivered' end, delivered_at = now() where provider_message_id = $1 and channel = 'sms'", [report.id]);
  } else if (report.state === 'failed') {
    await ctx.pool.query("update notifications set state = 'failed', error = $2 where provider_message_id = $1 and channel = 'sms' and state <> 'acked'", [report.id, `delivery failed ${report.error ?? ''}`.trim()]);
  }
}
