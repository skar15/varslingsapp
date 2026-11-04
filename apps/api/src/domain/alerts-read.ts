import { type AlertLevel, type Locale, type schemas } from '@varsling/shared';
import type { z } from 'zod';
import type { Ctx } from '../context';
import { many, one } from '../db/client';
import { notFound } from '../lib/errors';
import { iso, isoReq } from '../lib/time';
import { loadObjects, monitoredFor, toSummary } from './objects';
import type { Actor } from './permissions';
import { adviceFor, loadReference } from './reference';

interface AlertRow {
  id: string;
  source: string;
  msg_type: 'alert' | 'update' | 'cancel';
  event_key: string;
  situation_key: string | null;
  level: AlertLevel | null;
  source_level: string;
  onset: Date | null;
  expires: Date;
  sent_at: Date;
  fetched_at: Date;
  title_nb: string | null;
  title_en: string | null;
  description_nb: string | null;
  description_en: string | null;
  instruction_nb: string | null;
  instruction_en: string | null;
  web_url: string | null;
  superseded_by: string | null;
  object_ids: string[];
}

const pick = (nb: string | null, en: string | null, locale: Locale) => (locale === 'en' ? (en ?? nb) : (nb ?? en));

function summaryDto(a: AlertRow, locale: Locale) {
  return {
    id: a.id,
    source: a.source,
    msg_type: a.msg_type,
    event_key: a.event_key,
    situation_key: a.situation_key,
    level: a.level,
    source_level: a.source_level,
    onset: iso(a.onset),
    expires: isoReq(a.expires),
    title: pick(a.title_nb, a.title_en, locale),
    superseded: !!a.superseded_by,
  };
}

/** Alerts touching the account's objects. Scoped by account through the spatial join. */
export async function listAlerts(ctx: Ctx, actor: Actor, q: z.infer<typeof schemas.AlertListQuery>): Promise<z.infer<typeof schemas.AlertList>> {
  const params: unknown[] = [actor.accountId, ctx.now(), q.include_past ? 7 : 0, q.limit + 1];
  let cursorSql = '';
  if (q.cursor) {
    const [sent, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
    params.push(sent, id);
    cursorSql = `and (a.sent_at, a.id) < ($5::timestamptz, $6::uuid)`;
  }
  if (q.object_id) params.push(q.object_id);
  const rows = await many<AlertRow>(
    ctx.pool,
    `select a.*, array_agg(o.id order by o.id) as object_ids
     from alerts a join objects o on o.account_id = $1 and o.deleted_at is null and o.geom is not null and st_intersects(a.geom, o.geom)
     where a.superseded_by is null and a.level is not null and a.expires > $2::timestamptz - make_interval(days => $3::int) ${cursorSql}
       ${q.object_id ? `and o.id = $${params.length}` : ''}
     group by a.id order by a.sent_at desc, a.id desc limit $4`,
    params,
  );
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((a) => ({ ...summaryDto(a, actor.locale), object_ids: a.object_ids })),
    next_cursor: rows.length > q.limit && last ? Buffer.from(`${last.sent_at.toISOString()}|${last.id}`).toString('base64url') : null,
  };
}

export async function getAlert(ctx: Ctx, actor: Actor, id: string): Promise<z.infer<typeof schemas.AlertDetail>> {
  const a = await one<AlertRow & { geometry: z.infer<typeof schemas.MultiPolygonSchema> }>(
    ctx.pool,
    `select a.*, st_asgeojson(a.geom::geometry, 5)::json as geometry,
            coalesce(array_agg(o.id) filter (where o.id is not null), '{}') as object_ids
     from alerts a left join objects o on o.account_id = $2 and o.deleted_at is null and o.geom is not null and st_intersects(a.geom, o.geom)
     where a.id = $1 group by a.id`,
    [id, actor.accountId],
  );
  // Cross-account protection: an alert is visible only if it touches one of the caller's
  // objects, or the caller was notified about it.
  const notification = await one<{ id: string; acked_at: Date | null; level: AlertLevel }>(
    ctx.pool, `select id, acked_at, level from notifications where alert_id = $1 and user_id = $2 order by queued_at desc limit 1`, [id, actor.id],
  );
  if (!a || (!a.object_ids.length && !notification)) throw notFound('alert');
  const ref = await loadReference(ctx.pool);
  const objects = (await loadObjects(ctx, ctx.pool, actor.accountId)).filter((o) => a.object_ids.includes(o.id));
  return {
    ...summaryDto(a, actor.locale),
    issuer: a.source.startsWith('nve') ? 'NVE' : a.source === 'sim' ? 'TEST' : 'MET',
    description: pick(a.description_nb, a.description_en, actor.locale),
    instruction: pick(a.instruction_nb, a.instruction_en, actor.locale),
    web_url: a.web_url,
    geometry: a.geometry,
    fetched_at: isoReq(a.fetched_at),
    sent_at: isoReq(a.sent_at),
    objects: objects
      .filter((o) => !a.situation_key || monitoredFor(ref, o).has(a.situation_key))
      .map((o) => ({ id: o.id, display_name: toSummary(ref, o, actor.locale).display_name, advice: adviceFor(ref, a.situation_key, o.status_key, o.type_key, actor.locale) })),
    notification: notification ? { id: notification.id, acked_at: iso(notification.acked_at), level: notification.level } : null,
  };
}

export async function listNotifications(ctx: Ctx, actor: Actor, q: z.infer<typeof schemas.CursorQuery>): Promise<z.infer<typeof schemas.NotificationList>> {
  const params: unknown[] = [actor.id, q.limit + 1];
  let cursorSql = '';
  if (q.cursor) {
    const [at, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
    params.push(at, id);
    cursorSql = 'and (queued_at, id) < ($3::timestamptz, $4::uuid)';
  }
  const rows = await many<{ id: string; alert_id: string; object_id: string; kind: 'alert' | 'cancel'; level: AlertLevel; channel: 'push' | 'sms'; state: 'queued' | 'sent' | 'delivered' | 'failed' | 'acked' | 'suppressed'; queued_at: Date; sent_at: Date | null; acked_at: Date | null }>(
    ctx.pool,
    `select id, alert_id, object_id, kind, level, channel, state, queued_at, sent_at, acked_at from notifications
     where user_id = $1 ${cursorSql} order by queued_at desc, id desc limit $2`,
    params,
  );
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((n) => ({ ...n, queued_at: isoReq(n.queued_at), sent_at: iso(n.sent_at), acked_at: iso(n.acked_at) })),
    next_cursor: rows.length > q.limit && last ? Buffer.from(`${last.queued_at.toISOString()}|${last.id}`).toString('base64url') : null,
  };
}
