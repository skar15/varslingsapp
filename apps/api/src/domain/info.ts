import { formatDateTime, t, toGsm7, truncate, type Locale } from '@varsling/shared';
import type { Ctx } from '../context';
import { many } from '../db/client';
import type { InfoParam, InfoPush } from '../jobs/types';
import { sendSmsWithCap } from './sms';

function resolve(p: InfoParam, locale: Locale): string {
  if (typeof p === 'string') return p;
  if ('time' in p) return formatDateTime(p.time, locale);
  return (locale === 'en' ? p.en : undefined) ?? p.nb;
}

/**
 * Informational pushes on the alert-info channel: status changes, proposal results,
 * user removal, SMS-cap warning. SMS only when asked for and the user has no device.
 */
export async function deliverInfo(ctx: Ctx, info: InfoPush): Promise<void> {
  if (!info.userIds.length) return;
  const users = await many<{ id: string; account_id: string; locale: Locale; phone_e164: string | null; phone_verified_at: Date | null; tokens: string[] }>(
    ctx.pool,
    `select u.id, u.account_id, u.locale, u.phone_e164, u.phone_verified_at,
            coalesce(array_agg(d.push_token) filter (where d.id is not null), '{}') as tokens
     from users u left join devices d on d.user_id = u.id and d.disabled_at is null
     where u.id = any($1) group by u.id`,
    [info.userIds],
  );
  for (const u of users) {
    const params = Object.fromEntries(Object.entries(info.params ?? {}).map(([k, v]) => [k, resolve(v, u.locale)]));
    const body = t(u.locale, info.bodyKey, params);
    const title = info.titleKey ? t(u.locale, info.titleKey, params) : t(u.locale, 'app.name');
    if (u.tokens.length) {
      const tickets = await ctx.providers.push.send(
        u.tokens.map((to) => ({ to, title, body, data: { kind: 'info', ...(info.data ?? {}) }, channelId: 'alert-info' as const, categoryId: info.category, priority: 'default' as const })),
      );
      await disableUnregistered(ctx, u.tokens, tickets);
    } else if (info.smsFallback && u.phone_e164 && u.phone_verified_at) {
      await sendSmsWithCap(ctx, { accountId: u.account_id, to: u.phone_e164, body: truncate(toGsm7(body), 160), red: false });
    }
  }
}

export async function disableUnregistered(ctx: Ctx, tokens: string[], tickets: { ok: boolean; error?: string }[]): Promise<void> {
  const dead = tokens.filter((_, i) => tickets[i]?.error === 'DeviceNotRegistered');
  if (dead.length) await ctx.pool.query('update devices set disabled_at = now() where push_token = any($1) and disabled_at is null', [dead]);
}
