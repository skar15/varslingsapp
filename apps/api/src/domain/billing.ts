import { t, type Locale, type schemas } from '@varsling/shared';
import type { z } from 'zod';
import type { Ctx } from '../context';
import { many, one, withTx } from '../db/client';
import { audit } from '../lib/audit';
import { decrypt, encrypt, hashToken, newToken } from '../lib/crypto';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import type { BillingEvent } from '../providers/payment';
import { getAccount, getPlan, planDto, usage, type PlanRow } from './accounts';
import { assertCan, type Actor } from './permissions';

const CLAIM_TTL_MS = 7 * 86_400_000;

export async function listPlans(ctx: Ctx) {
  const rows = await many<PlanRow>(ctx.pool, 'select key, name, i18n, max_users, max_objects, sms_monthly_cap, stripe_price_id from plans where active order by sort, key');
  return rows.map(planDto);
}

/**
 * Checkout. The claim token is generated here: its hash is stored when the webhook creates
 * the account, the plain token goes to the success URL, and an encrypted copy rides in the
 * session metadata so the webhook can email the claim link (docs/decisions/004).
 */
export async function createCheckout(ctx: Ctx, planKey: string, locale: Locale): Promise<{ url: string }> {
  const plan = await getPlan(ctx.pool, planKey);
  if (!plan?.stripe_price_id) throw unprocessable('plan_not_purchasable', 'plan has no price configured');
  const token = newToken();
  const session = await ctx.providers.payment.createCheckoutSession({
    priceId: plan.stripe_price_id,
    planKey,
    locale,
    successUrl: `${ctx.env.WEB_URL}/${locale}/register/${token}`,
    cancelUrl: `${ctx.env.WEB_URL}/${locale}#plans`,
    metadata: { plan_key: planKey, claim: encrypt(token, ctx.env.CLAIM_TOKEN_SECRET), locale },
  });
  return { url: session.url };
}

/** Stripe webhook. Each event id is processed once through processed_webhooks. */
export async function handleBillingEvent(ctx: Ctx, ev: BillingEvent): Promise<'processed' | 'duplicate'> {
  let claimEmail: { to: string; token: string } | null = null;
  let pastDueOwner: string | null = null;
  const outcome = await withTx(ctx.pool, async (db) => {
    const fresh = await one<{ event_id: string }>(db, 'insert into processed_webhooks(event_id, type) values ($1,$2) on conflict do nothing returning event_id', [ev.id, ev.type]);
    if (!fresh) return 'duplicate' as const;
    switch (ev.type) {
      case 'checkout.completed': {
        if (!ev.claimEnc || !ev.planKey) {
          ctx.log.warn({ eventId: ev.id }, 'checkout without claim metadata');
          break;
        }
        const token = decrypt(ev.claimEnc, ctx.env.CLAIM_TOKEN_SECRET);
        const row = await one<{ id: string }>(
          db,
          `insert into accounts(kind, plan_key, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id, status, claim_token_hash, claim_expires_at, claim_email)
           values ('person', $1, $2, $3, $4, 'pending_profile', $5, $6, $7)
           on conflict (stripe_checkout_session_id) do nothing returning id`,
          [ev.planKey, ev.customerId, ev.subscriptionId, ev.sessionId, hashToken(token), new Date(ctx.now().getTime() + CLAIM_TTL_MS), ev.email],
        );
        if (row) {
          await audit(db, { accountId: row.id, actorId: null, action: 'account.created', targetType: 'account', targetId: row.id, metadata: { plan_key: ev.planKey } });
          if (ev.email) claimEmail = { to: ev.email, token };
        }
        break;
      }
      case 'subscription.updated': {
        const acc = await one<{ id: string; status: string; plan_key: string | null }>(db, 'select id, status, plan_key from accounts where stripe_subscription_id = $1', [ev.subscriptionId]);
        if (!acc) break;
        const plan = ev.priceId ? await one<{ key: string }>(db, 'select key from plans where stripe_price_id = $1', [ev.priceId]) : undefined;
        const status = ['past_due', 'unpaid'].includes(ev.status) ? 'past_due' : ev.status === 'canceled' ? 'canceled' : ev.status === 'active' && acc.status === 'past_due' ? 'active' : null;
        await db.query(
          `update accounts set plan_key = coalesce($2, plan_key), cancel_at_period_end = $3,
             status = case when status in ('deleted','pending_profile') then status else coalesce($4::account_status, status) end,
             past_due_since = case when $4 = 'past_due' then coalesce(past_due_since, now()) when $4 = 'active' then null else past_due_since end,
             updated_at = now() where id = $1`,
          [acc.id, plan?.key ?? null, ev.cancelAtPeriodEnd, status],
        );
        if (plan && plan.key !== acc.plan_key) await audit(db, { accountId: acc.id, actorId: null, action: 'account.plan_changed', targetType: 'account', targetId: acc.id, metadata: { from: acc.plan_key, to: plan.key } });
        break;
      }
      case 'subscription.deleted': {
        const acc = await one<{ id: string }>(db, "update accounts set status = case when status = 'deleted' then status else 'canceled' end, updated_at = now() where stripe_subscription_id = $1 returning id", [ev.subscriptionId]);
        if (acc) await audit(db, { accountId: acc.id, actorId: null, action: 'account.canceled', targetType: 'account', targetId: acc.id });
        break;
      }
      case 'invoice.payment_failed': {
        if (!ev.subscriptionId) break;
        const acc = await one<{ id: string }>(
          db,
          `update accounts set status = 'past_due', past_due_since = coalesce(past_due_since, now()), updated_at = now()
           where stripe_subscription_id = $1 and status in ('active','past_due') returning id`,
          [ev.subscriptionId],
        );
        if (acc) {
          await audit(db, { accountId: acc.id, actorId: null, action: 'account.past_due', targetType: 'account', targetId: acc.id });
          pastDueOwner = acc.id;
        }
        break;
      }
      case 'invoice.paid': {
        if (!ev.subscriptionId) break;
        await db.query("update accounts set status = 'active', past_due_since = null, updated_at = now() where stripe_subscription_id = $1 and status = 'past_due'", [ev.subscriptionId]);
        break;
      }
      default:
        break;
    }
    return 'processed' as const;
  });
  if (claimEmail) {
    const c = claimEmail as { to: string; token: string };
    await ctx.providers.email
      .send({ to: c.to, subject: t('nb', 'msg.claim.subject'), text: t('nb', 'msg.claim.body', { link: `${ctx.env.WEB_URL}/nb/register/${c.token}` }) })
      .catch((err) => ctx.log.error({ err: (err as Error).message }, 'claim email failed'));
  }
  if (pastDueOwner) {
    const owner = await one<{ id: string; email: string | null; locale: Locale }>(ctx.pool, "select id, email, locale from users where account_id = $1 and role = 'owner' and removed_at is null", [pastDueOwner]);
    if (owner) {
      await ctx.jobs.send('info.push', { userIds: [owner.id], bodyKey: 'msg.pastDue' });
      if (owner.email) await ctx.providers.email.send({ to: owner.email, subject: t(owner.locale, 'app.name'), text: t(owner.locale, 'msg.pastDue') }).catch(() => undefined);
    }
  }
  return outcome;
}

async function claimAccount(ctx: Ctx, token: string, forUpdate: boolean, db = ctx.pool as import('../db/client').Db) {
  const acc = await one<{ id: string; plan_key: string; claim_email: string | null; claim_expires_at: Date; status: string }>(
    db,
    `select id, plan_key, claim_email, claim_expires_at, status from accounts
     where claim_token_hash = $1 and status = 'pending_profile' and claim_expires_at > $2 and deleted_at is null ${forUpdate ? 'for update' : ''}`,
    [hashToken(token), ctx.now()],
  );
  if (!acc) throw notFound('claim');
  return acc;
}

export async function getClaim(ctx: Ctx, token: string): Promise<z.infer<typeof schemas.ClaimInfo>> {
  const acc = await claimAccount(ctx, token, false);
  const plan = await getPlan(ctx.pool, acc.plan_key);
  return { account_id: acc.id, plan: planDto(plan!), email: acc.claim_email, expires_at: acc.claim_expires_at.toISOString() };
}

/**
 * "Neste": creates the owner (Supabase user from the JWT), activates the account and
 * invalidates the single-use claim token. Under 18 is blocked by the schema (confirm_adult).
 */
export async function completeClaim(ctx: Ctx, identity: { sub: string; email: string | null }, token: string, input: z.infer<typeof schemas.ClaimComplete>): Promise<string> {
  const authUser = await ctx.providers.authAdmin.getUser(identity.sub);
  if (!authUser?.phone || !authUser.phone_confirmed) throw unprocessable('phone_not_verified', 'the owner must verify the mobile number by OTP');
  if (!/^\+47\d{8}$/.test(authUser.phone)) throw badRequest('phone_not_supported', 'only +47 numbers are supported at launch');
  return withTx(ctx.pool, async (db) => {
    const acc = await claimAccount(ctx, token, true, db);
    const existing = await one<{ id: string }>(db, 'select id from users where id = $1', [identity.sub]);
    if (existing) throw conflict('already_member', 'this login already belongs to an account');
    await db.query(
      `update accounts set kind = $2, legal_name = $3, org_number = $4, status = 'active', claim_token_hash = null, claim_expires_at = null,
         terms_accepted_at = now(), adult_confirmed_at = now(), updated_at = now() where id = $1`,
      [acc.id, input.kind, input.kind === 'person' ? null : (input.legal_name ?? null), input.kind === 'person' ? null : (input.org_number ?? null)],
    );
    await db.query(
      `insert into users(id, account_id, role, name, email, phone_e164, phone_verified_at, locale) values ($1,$2,'owner',$3,$4,$5,now(),$6)`,
      [identity.sub, acc.id, input.owner_name, identity.email ?? authUser.email ?? acc.claim_email, authUser.phone, input.locale],
    );
    if (input.kind === 'person') await db.query('update accounts set legal_name = $2 where id = $1', [acc.id, input.owner_name]);
    await audit(db, { accountId: acc.id, actorId: identity.sub, action: 'account.activated', targetType: 'account', targetId: acc.id, metadata: { kind: input.kind } });
    return acc.id;
  });
}

export async function portalSession(ctx: Ctx, actor: Actor): Promise<{ url: string }> {
  assertCan(actor, 'billing');
  const acc = await getAccount(ctx.pool, actor.accountId);
  if (!acc.stripe_customer_id) throw conflict('no_billing_customer');
  return ctx.providers.payment.createPortalSession({ customerId: acc.stripe_customer_id, returnUrl: `${ctx.env.WEB_URL}/account` });
}

/** Plan change initiated in the app: a downgrade below current usage is refused (docs/decisions/005). */
export async function changePlan(ctx: Ctx, actor: Actor, planKey: string): Promise<void> {
  assertCan(actor, 'billing');
  const acc = await getAccount(ctx.pool, actor.accountId);
  const plan = await getPlan(ctx.pool, planKey);
  if (!plan?.stripe_price_id) throw unprocessable('plan_not_purchasable');
  if (!acc.stripe_subscription_id) throw conflict('no_subscription');
  const u = await usage(ctx.pool, acc.id, ctx.now());
  if (u.users + u.pending_invitations > plan.max_users || u.objects > plan.max_objects) {
    throw new AppError(409, 'downgrade_below_usage', 'remove users or objects before downgrading', { usage: u, plan: planDto(plan) });
  }
  await ctx.providers.payment.changePlan({ subscriptionId: acc.stripe_subscription_id, priceId: plan.stripe_price_id });
  await audit(ctx.pool, { accountId: acc.id, actorId: actor.id, action: 'account.plan_change_requested', targetType: 'account', targetId: acc.id, metadata: { to: planKey } });
}

/**
 * Only the owner can delete the account. The subscription is cancelled immediately, users
 * lose access, and the erasure job removes personal data (schema rule 4).
 */
export async function requestDeletion(ctx: Ctx, actor: Actor): Promise<void> {
  if (actor.effective !== 'owner') throw forbidden();
  const acc = await getAccount(ctx.pool, actor.accountId);
  if (acc.stripe_subscription_id) await ctx.providers.payment.cancelSubscription({ subscriptionId: acc.stripe_subscription_id, immediately: true });
  const userIds = await withTx(ctx.pool, async (db) => {
    await db.query("update accounts set status = 'deleted', deleted_at = now(), updated_at = now() where id = $1", [acc.id]);
    const users = await many<{ id: string }>(db, 'select id from users where account_id = $1 and removed_at is null', [acc.id]);
    await db.query('update devices set disabled_at = now() where user_id = any($1) and disabled_at is null', [users.map((u) => u.id)]);
    await audit(db, { accountId: acc.id, actorId: actor.id, action: 'account.deletion_requested', targetType: 'account', targetId: acc.id });
    return users.map((u) => u.id);
  });
  for (const id of userIds) await ctx.providers.authAdmin.revoke(id).catch(() => undefined);
}
