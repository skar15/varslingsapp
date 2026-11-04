import { t, type Locale, type schemas } from '@varsling/shared';
import type { z } from 'zod';
import type { Ctx } from '../context';
import { many, one, withTx, type Db } from '../db/client';
import { audit } from '../lib/audit';
import { hashToken, newToken } from '../lib/crypto';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { iso, isoReq } from '../lib/time';
import { alertsPaused, getAccount, getPlan, planDto, usage } from './accounts';
import { deliverInfo } from './info';
import { assertCan, effectiveRole, type Actor } from './permissions';
import { sendSmsWithCap } from './sms';

const TOKEN_TTL_MS = 7 * 86_400_000;

interface UserRow {
  id: string;
  account_id: string;
  name: string;
  email: string | null;
  phone_e164: string | null;
  phone_verified_at: Date | null;
  role: 'owner' | 'member';
  can_manage_objects: boolean;
  locale: Locale;
  sms_for_all_levels: boolean;
  created_at: Date;
}

export function userDto(u: UserRow): z.infer<typeof schemas.UserSchema> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone_e164: u.phone_e164,
    phone_verified: !!u.phone_verified_at,
    role: u.role,
    can_manage_objects: u.can_manage_objects,
    effective_role: effectiveRole(u.role, u.can_manage_objects),
    locale: u.locale,
    created_at: isoReq(u.created_at),
  };
}

export async function accountDto(ctx: Ctx, db: Db, accountId: string): Promise<z.infer<typeof schemas.AccountSchema>> {
  const a = await getAccount(db, accountId);
  const plan = await getPlan(db, a.plan_key);
  return {
    id: a.id,
    kind: a.kind,
    legal_name: a.legal_name,
    org_number: a.org_number,
    status: a.status,
    alerts_paused: alertsPaused(a, ctx.env, ctx.now()),
    plan: plan ? planDto(plan) : null,
    usage: await usage(db, accountId, ctx.now()),
  };
}

export async function me(ctx: Ctx, actor: Actor): Promise<z.infer<typeof schemas.MeSchema>> {
  const u = await one<UserRow>(ctx.pool, 'select * from users where id = $1', [actor.id]);
  const account = await accountDto(ctx, ctx.pool, actor.accountId);
  return {
    user: { ...userDto(u!), sms_for_all_levels: u!.sms_for_all_levels },
    account,
    limits: account.plan ? { max_users: account.plan.max_users, max_objects: account.plan.max_objects, sms_monthly_cap: account.plan.sms_monthly_cap } : null,
  };
}

export async function patchMe(ctx: Ctx, actor: Actor, patch: z.infer<typeof schemas.MePatch>): Promise<void> {
  await withTx(ctx.pool, async (db) => {
    await db.query(
      `update users set name = coalesce($2, name), locale = coalesce($3, locale), sms_for_all_levels = coalesce($4, sms_for_all_levels), updated_at = now() where id = $1`,
      [actor.id, patch.name ?? null, patch.locale ?? null, patch.sms_for_all_levels ?? null],
    );
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'user.update_self', targetType: 'user', targetId: actor.id, metadata: { fields: Object.keys(patch) } });
  });
}

/**
 * Phone verification runs through Supabase Auth from the client. The API trusts a phone
 * number only after reading the confirmed number from Supabase with the service key.
 */
export async function refreshPhone(ctx: Ctx, actor: Actor): Promise<{ phone_e164: string | null; phone_verified: boolean }> {
  const rec = await ctx.providers.authAdmin.getUser(actor.id);
  if (!rec?.phone || !rec.phone_confirmed) return { phone_e164: null, phone_verified: false };
  if (!/^\+47\d{8}$/.test(rec.phone)) throw badRequest('phone_not_supported', 'only +47 numbers are supported at launch');
  await ctx.pool.query('update users set phone_e164 = $2, phone_verified_at = now(), updated_at = now() where id = $1', [actor.id, rec.phone]);
  await audit(ctx.pool, { accountId: actor.accountId, actorId: actor.id, action: 'user.phone_verified', targetType: 'user', targetId: actor.id });
  return { phone_e164: rec.phone, phone_verified: true };
}

export async function registerDevice(ctx: Ctx, actor: Actor, d: z.infer<typeof schemas.DeviceRegister>): Promise<string> {
  const r = await one<{ id: string }>(
    ctx.pool,
    `insert into devices(user_id, platform, push_token, app_version, last_seen_at) values ($1,$2,$3,$4,now())
     on conflict (push_token) do update set user_id = excluded.user_id, platform = excluded.platform, app_version = excluded.app_version,
       last_seen_at = now(), disabled_at = null
     returning id`,
    [actor.id, d.platform, d.push_token, d.app_version ?? null],
  );
  return r!.id;
}

export async function removeDevice(ctx: Ctx, actor: Actor, id: string): Promise<void> {
  const r = await ctx.pool.query('update devices set disabled_at = now() where id = $1 and user_id = $2', [id, actor.id]);
  if (!r.rowCount) throw notFound('device');
}

export async function listUsers(ctx: Ctx, actor: Actor): Promise<z.infer<typeof schemas.UserList>> {
  const users = await many<UserRow>(ctx.pool, 'select * from users where account_id = $1 and removed_at is null order by role, created_at', [actor.accountId]);
  const invitations = await many<{ id: string; channel: 'email' | 'sms'; email: string | null; phone_e164: string | null; name: string | null; expires_at: Date }>(
    ctx.pool,
    'select id, channel, email, phone_e164, name, expires_at from invitations where account_id = $1 and accepted_at is null and revoked_at is null and expires_at > $2 order by created_at',
    [actor.accountId, ctx.now()],
  );
  const account = await getAccount(ctx.pool, actor.accountId);
  const plan = await getPlan(ctx.pool, account.plan_key);
  const max = plan?.max_users ?? 0;
  return {
    items: users.map(userDto),
    invitations: actor.effective === 'owner'
      ? invitations.map((i) => ({ id: i.id, channel: i.channel, target: (i.channel === 'email' ? i.email : i.phone_e164) ?? '', name: i.name, expires_at: isoReq(i.expires_at) }))
      : [],
    can_invite: actor.effective === 'owner' && users.length + invitations.length < max,
    max_users: max,
  };
}

/** Pending invitations count toward the plan's user limit, checked in the same transaction (rule 1). */
export async function invite(ctx: Ctx, actor: Actor, input: z.infer<typeof schemas.InvitationCreate>): Promise<{ id: string; expires_at: string }> {
  assertCan(actor, 'manage_users');
  const token = newToken();
  const expires = new Date(ctx.now().getTime() + TOKEN_TTL_MS);
  const { id, legal } = await withTx(ctx.pool, async (db) => {
    const account = await getAccount(db, actor.accountId, true);
    const plan = await getPlan(db, account.plan_key);
    const u = await usage(db, actor.accountId, ctx.now());
    if (!plan || u.users + u.pending_invitations >= plan.max_users) throw conflict('plan_limit_users', 'user limit reached for the plan');
    const row = await one<{ id: string }>(
      db,
      `insert into invitations(account_id, token_hash, channel, email, phone_e164, name, invited_by, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [actor.accountId, hashToken(token), input.channel, input.channel === 'email' ? input.email : null, input.channel === 'sms' ? input.phone_e164 : null,
        input.name ?? null, actor.id, expires],
    );
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'user.invite', targetType: 'invitation', targetId: row!.id, metadata: { channel: input.channel } });
    return { id: row!.id, legal: account.legal_name };
  });
  const owner = await one<{ name: string; locale: Locale }>(ctx.pool, 'select name, locale from users where id = $1', [actor.id]);
  const link = `${ctx.env.WEB_URL}/invite/${token}`;
  const text = t(owner?.locale ?? 'nb', 'msg.invitation', { account: legal ?? owner?.name ?? '', link });
  if (input.channel === 'email') {
    await ctx.providers.email.send({ to: input.email, subject: t(owner?.locale ?? 'nb', 'msg.invitation.subject'), text });
  } else {
    await sendSmsWithCap(ctx, { accountId: actor.accountId, to: input.phone_e164, body: text, red: false });
  }
  return { id, expires_at: expires.toISOString() };
}

export async function revokeInvitation(ctx: Ctx, actor: Actor, id: string): Promise<void> {
  assertCan(actor, 'manage_users');
  const r = await ctx.pool.query('update invitations set revoked_at = now() where id = $1 and account_id = $2 and accepted_at is null', [id, actor.accountId]);
  if (!r.rowCount) throw notFound('invitation');
}

/**
 * The invited person signs in with Supabase (phone OTP), then accepts with the token.
 * users.id equals the Supabase auth user id, so one person belongs to one account.
 */
export async function acceptInvitation(ctx: Ctx, identity: { sub: string; email: string | null }, token: string, input: z.infer<typeof schemas.InvitationAccept>): Promise<string> {
  const authUser = await ctx.providers.authAdmin.getUser(identity.sub);
  return withTx(ctx.pool, async (db) => {
    const inv = await one<{ id: string; account_id: string; channel: string; phone_e164: string | null }>(
      db,
      `select id, account_id, channel, phone_e164 from invitations
       where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > $2 for update`,
      [hashToken(token), ctx.now()],
    );
    if (!inv) throw notFound('invitation');
    const account = await getAccount(db, inv.account_id);
    if (!['active', 'past_due'].includes(account.status)) throw conflict('account_inactive');
    const existing = await one<{ account_id: string; removed_at: Date | null }>(db, 'select account_id, removed_at from users where id = $1', [identity.sub]);
    if (existing && existing.account_id !== inv.account_id && !existing.removed_at) throw conflict('already_member', 'this login already belongs to another account');
    if (existing && existing.account_id !== inv.account_id) throw conflict('already_member', 'this login was used in another account');
    const phone = authUser?.phone_confirmed && authUser.phone && /^\+47\d{8}$/.test(authUser.phone) ? authUser.phone : null;
    if (existing) {
      await db.query(
        `update users set removed_at = null, role = 'member', can_manage_objects = false, name = $2, locale = $3, email = coalesce($4, email),
           phone_e164 = coalesce($5, phone_e164), phone_verified_at = case when $5::text is not null then now() else phone_verified_at end, updated_at = now()
         where id = $1`,
        [identity.sub, input.name, input.locale, identity.email, phone],
      );
      await ctx.providers.authAdmin.restore(identity.sub);
    } else {
      await db.query(
        `insert into users(id, account_id, role, name, email, phone_e164, phone_verified_at, locale) values ($1,$2,'member',$3,$4,$5,$6,$7)`,
        [identity.sub, inv.account_id, input.name, identity.email, phone, phone ? ctx.now() : null, input.locale],
      );
    }
    await db.query('update invitations set accepted_at = now(), accepted_user_id = $2 where id = $1', [inv.id, identity.sub]);
    await audit(db, { accountId: inv.account_id, actorId: identity.sub, action: 'user.join', targetType: 'user', targetId: identity.sub });
    return inv.account_id;
  });
}

/**
 * Owner removes a user (after a confirmation dialog in the UI). The user is told, their
 * devices are disabled and their sessions revoked.
 */
export async function removeUser(ctx: Ctx, actor: Actor, userId: string): Promise<void> {
  assertCan(actor, 'manage_users');
  if (userId === actor.id) throw forbidden('cannot_remove_self');
  const target = await one<{ id: string; role: string }>(ctx.pool, 'select id, role from users where id = $1 and account_id = $2 and removed_at is null', [userId, actor.accountId]);
  if (!target) throw notFound('user');
  if (target.role === 'owner') throw forbidden('cannot_remove_owner');
  const account = await getAccount(ctx.pool, actor.accountId);
  // Tell the user first, while their devices still work.
  await deliverInfo(ctx, { userIds: [userId], bodyKey: 'msg.userRemoved', params: { account: account.legal_name ?? actor.name }, smsFallback: true }).catch((err) =>
    ctx.log.warn({ err: (err as Error).message, userId }, 'removal notice failed'),
  );
  await withTx(ctx.pool, async (db) => {
    await db.query('update users set removed_at = now(), can_manage_objects = false, updated_at = now() where id = $1', [userId]);
    await db.query('update devices set disabled_at = now() where user_id = $1 and disabled_at is null', [userId]);
    await db.query('delete from object_recipients where user_id = $1', [userId]);
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'user.remove', targetType: 'user', targetId: userId });
  });
  await ctx.providers.authAdmin.revoke(userId);
}

export async function setRights(ctx: Ctx, actor: Actor, userId: string, canManageObjects: boolean): Promise<void> {
  assertCan(actor, 'delegate');
  await withTx(ctx.pool, async (db) => {
    const r = await db.query(
      "update users set can_manage_objects = $3, updated_at = now() where id = $1 and account_id = $2 and removed_at is null and role = 'member'",
      [userId, actor.accountId, canManageObjects],
    );
    if (!r.rowCount) throw notFound('user');
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: canManageObjects ? 'user.delegate' : 'user.undelegate', targetType: 'user', targetId: userId });
  });
}

export { iso };
