import { objectDisplayName } from '@varsling/shared';
import type { Ctx } from '../context';
import { many, one } from '../db/client';
import { audit } from '../lib/audit';
import { addMinutes } from '../lib/time';
import { loadReference, statusI18n, typeName } from './reference';

interface StatusObj {
  id: string;
  account_id: string;
  nickname: string | null;
  type_key: string | null;
  place_label: string | null;
  status_key: string;
  normal_status_key: string;
  status_set_by: string | null;
  status_version: number;
}

const load = (ctx: Ctx, id: string) =>
  one<StatusObj>(ctx.pool, 'select id, account_id, nickname, type_key, place_label, status_key, normal_status_key, status_set_by, status_version from objects where id = $1 and deleted_at is null', [id]);

/**
 * At the end time the user who set the status is asked whether to extend. Delayed job that
 * re-checks the status version, so a manual change in between makes it do nothing.
 */
export async function onStatusExpire(ctx: Ctx, data: { objectId: string; version: number }): Promise<'asked' | 'stale'> {
  const o = await load(ctx, data.objectId);
  if (!o || o.status_version !== data.version || o.status_key === o.normal_status_key) return 'stale';
  const ref = await loadReference(ctx.pool);
  if (o.status_set_by) {
    await ctx.jobs.send('info.push', {
      userIds: [o.status_set_by],
      bodyKey: 'msg.statusExtendQuestion',
      params: { status: statusI18n(ref, o.status_key), object: objectDisplayName(o.nickname, typeName(ref, o.type_key, 'nb'), o.place_label, 'Objekt') },
      category: 'status-extend',
      data: { object_id: o.id, kind: 'status-extend', url: `varsling://objects/${o.id}?extend=1` },
    });
  }
  await ctx.jobs.send('status.revert', data, { startAfter: addMinutes(ctx.now(), ctx.env.STATUS_EXTENSION_GRACE_MINUTES) });
  return 'asked';
}

/** With no answer within the grace period the status returns to normal and everyone is told. */
export async function onStatusRevert(ctx: Ctx, data: { objectId: string; version: number }): Promise<'reverted' | 'stale'> {
  const r = await one<{ id: string; account_id: string }>(
    ctx.pool,
    `update objects set status_key = normal_status_key, status_until = null, status_set_by = null, status_version = status_version + 1, updated_at = now()
     where id = $1 and status_version = $2 and deleted_at is null and status_key <> normal_status_key returning id, account_id`,
    [data.objectId, data.version],
  );
  if (!r) return 'stale';
  await audit(ctx.pool, { accountId: r.account_id, actorId: null, action: 'object.status_revert', targetType: 'object', targetId: r.id });
  const o = (await load(ctx, data.objectId))!;
  const ref = await loadReference(ctx.pool);
  const users = await many<{ id: string }>(ctx.pool, 'select id from users where account_id = $1 and removed_at is null', [r.account_id]);
  await ctx.jobs.send('info.push', {
    userIds: users.map((u) => u.id),
    bodyKey: 'msg.statusReverted',
    params: { status: statusI18n(ref, o.normal_status_key), object: objectDisplayName(o.nickname, typeName(ref, o.type_key, 'nb'), o.place_label, 'Objekt') },
    data: { object_id: o.id, url: `varsling://objects/${o.id}` },
  });
  return 'reverted';
}
