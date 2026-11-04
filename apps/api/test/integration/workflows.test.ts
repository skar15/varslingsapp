import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { many, one } from '../../src/db/client';
import { runErasure, runRetention } from '../../src/domain/maintenance';
import { sendSmsWithCap } from '../../src/domain/sms';
import { signTestToken } from '../../src/providers/auth';
import { addUser, app, call, createAccount, JWT_SECRET, makeCtx, PLACES, resetDb, type TestCtx } from '../helpers/ctx';

let ctx: TestCtx;
let a: FastifyInstance;
const point = { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.andenes } };

beforeAll(async () => {
  ctx = makeCtx();
  a = await app(ctx);
});
beforeEach(async () => {
  await resetDb();
  ctx.jobs.jobs = [];
  ctx.fakes.push.sent = [];
  ctx.fakes.sms.sent = [];
  ctx.fakes.email.sent = [];
  ctx.opsAlerts.length = 0;
  ctx.clock.now = new Date('2026-11-05T08:00:00Z');
});

const infoBodies = () => ctx.fakes.push.sent.filter((m) => m.channelId === 'alert-info').map((m) => m.body);

describe('A8: temporary status', () => {
  it('others are told who changed it; at the end the setter is asked; no answer in 120 min reverts and tells everyone', async () => {
    const { owner } = await createAccount(ctx);
    const kari = await addUser(ctx, owner.accountId, { name: 'Kari' });
    const id = (await call(a, owner).post('/v1/objects', { nickname: 'Huset', type_key: 'private_home', location: point })).json().id;
    const until = new Date(ctx.now().getTime() + 2 * 3_600_000);
    expect((await call(a, kari).put(`/v1/objects/${id}/status`, { status_key: 'exterior_work', until: until.toISOString() })).statusCode).toBe(204);
    await ctx.drain();
    expect(infoBodies()).toEqual(['Kari satte Huset til «Utvendig arbeid på fasade og tak» til 05.11 11:00']);
    expect(ctx.fakes.push.sent[0]!.to).toContain(owner.id);

    // The status adds precipitation to what is monitored.
    const o = (await call(a, owner).get(`/v1/objects/${id}`)).json();
    expect(o.monitored.find((m: { key: string }) => m.key === 'precipitation').added_by_status).toBe(true);

    ctx.fakes.push.sent = [];
    ctx.clock.now = until;
    await ctx.drain({ until });
    expect(ctx.fakes.push.sent.map((m) => [m.to.includes(kari.id), m.categoryId, m.body])).toEqual([
      [true, 'status-extend', 'Statusen «Utvendig arbeid på fasade og tak» for Huset er utløpt. Vil du forlenge?'],
    ]);

    ctx.fakes.push.sent = [];
    const later = new Date(until.getTime() + 121 * 60_000);
    ctx.clock.now = later;
    await ctx.drain({ until: later });
    const row = await one<{ status_key: string; status_until: Date | null }>(ctx.pool, 'select status_key, status_until from objects where id = $1', [id]);
    expect(row).toEqual({ status_key: 'normal', status_until: null });
    expect(infoBodies()).toEqual(['Huset er tilbake til «Normal»', 'Huset er tilbake til «Normal»']);
  });

  it('extending in between makes the old jobs do nothing', async () => {
    const { owner } = await createAccount(ctx);
    const id = (await call(a, owner).post('/v1/objects', { type_key: 'boat', location: point })).json().id;
    const until = new Date(ctx.now().getTime() + 3_600_000);
    await call(a, owner).put(`/v1/objects/${id}/status`, { status_key: 'moored', until: until.toISOString() });
    const extended = new Date(ctx.now().getTime() + 5 * 3_600_000);
    expect((await call(a, owner).post(`/v1/objects/${id}/status/extend`, { until: extended.toISOString() })).statusCode).toBe(204);
    const after = new Date(until.getTime() + 3 * 3_600_000);
    ctx.clock.now = after;
    await ctx.drain({ until: after });
    expect((await one<{ status_key: string }>(ctx.pool, 'select status_key from objects where id = $1', [id]))!.status_key).toBe('moored');
  });

  it('a temporary status needs an end time, and must fit the object type', async () => {
    const { owner } = await createAccount(ctx);
    const id = (await call(a, owner).post('/v1/objects', { type_key: 'private_home', location: point })).json().id;
    expect((await call(a, owner).put(`/v1/objects/${id}/status`, { status_key: 'loose_items' })).json().code).toBe('status_until_required');
    expect((await call(a, owner).put(`/v1/objects/${id}/status`, { status_key: 'moored', until: '2026-11-06T00:00:00Z' })).json().code).toBe('status_not_for_type');
  });

  it('the owner defines what counts as normal', async () => {
    const { owner } = await createAccount(ctx);
    const id = (await call(a, owner).post('/v1/objects', { type_key: 'boat', location: point })).json().id;
    await call(a, owner).put(`/v1/objects/${id}/normal-status`, { status_key: 'moored' });
    const o = (await call(a, owner).get(`/v1/objects/${id}`)).json();
    expect([o.normal_status_key, o.status_key]).toEqual(['moored', 'moored']);
  });
});

describe('A9: change proposals', () => {
  it('a member proposes an object, the owner approves in one tap, the object exists, the member gets the result', async () => {
    const { owner } = await createAccount(ctx);
    const member = await addUser(ctx, owner.accountId, { name: 'Ola' });
    const p = await call(a, member).post('/v1/proposals', { kind: 'object_create', payload: { nickname: 'Naust', type_key: 'pier', location: point }, message: 'Kan vi legge til naustet?' });
    expect(p.statusCode).toBe(201);
    await ctx.drain();
    expect(infoBodies()).toEqual(['Nytt forslag fra Ola']);
    const inbox = (await call(a, owner).get('/v1/proposals')).json().items;
    expect(inbox[0]).toMatchObject({ kind: 'object_create', status: 'pending', can_decide: true });
    expect((await call(a, member).get('/v1/proposals')).json().items[0].can_decide).toBe(false);

    ctx.fakes.push.sent = [];
    expect((await call(a, owner).post(`/v1/proposals/${p.json().id}/approve`, { note: 'Fint' })).statusCode).toBe(204);
    await ctx.drain();
    const objects = (await call(a, owner).get('/v1/objects')).json().items;
    expect(objects.map((o: { nickname: string }) => o.nickname)).toEqual(['Naust']);
    expect(ctx.fakes.push.sent.map((m) => [m.title, m.body])).toEqual([['Forslaget ditt ble godkjent', 'Kommentar: Fint']]);
    expect((await call(a, owner).post(`/v1/proposals/${p.json().id}/approve`)).json().code).toBe('proposal_decided');
  });

  it('user proposals go to the owner only; delegates cannot decide them', async () => {
    const { owner } = await createAccount(ctx);
    const delegate = await addUser(ctx, owner.accountId, { delegate: true });
    const member = await addUser(ctx, owner.accountId);
    const p = (await call(a, member).post('/v1/proposals', { kind: 'user_invite', payload: { channel: 'email', email: 'venn@example.invalid' } })).json();
    expect((await call(a, delegate).post(`/v1/proposals/${p.id}/approve`)).statusCode).toBe(403);
    expect((await call(a, owner).post(`/v1/proposals/${p.id}/reject`, { note: 'Nei' })).statusCode).toBe(204);
    expect((await call(a, member).get('/v1/proposals')).json().items[0].status).toBe('rejected');
  });

  it('approval that fails validation (plan limit) leaves the proposal pending', async () => {
    const { owner } = await createAccount(ctx, { plan: 'basis' });
    const member = await addUser(ctx, owner.accountId);
    for (let i = 0; i < 3; i++) await call(a, owner).post('/v1/objects', { type_key: 'boat', location: point });
    const p = (await call(a, member).post('/v1/proposals', { kind: 'object_create', payload: { type_key: 'boat', location: point } })).json();
    expect((await call(a, owner).post(`/v1/proposals/${p.id}/approve`)).json().code).toBe('plan_limit_objects');
    expect((await call(a, owner).get('/v1/proposals')).json().items[0].status).toBe('pending');
  });
});

describe('A10, A11: users', () => {
  it('A10: plan allows 3 users; 2 users and 1 pending invitation -> plus dimmed and API refuses a fourth', async () => {
    await ctx.pool.query("insert into plans(key, name, max_users, max_objects, sms_monthly_cap) values ('tre', 'Tre', 3, 5, 10) on conflict (key) do update set max_users = 3");
    const { owner } = await createAccount(ctx, { plan: 'tre' });
    await addUser(ctx, owner.accountId);
    expect((await call(a, owner).post('/v1/users/invitations', { channel: 'sms', phone_e164: '+4791234567', name: 'Per' })).statusCode).toBe(201);
    expect(ctx.fakes.sms.sent[0]!.body).toContain('https://app.test/invite/');
    const list = (await call(a, owner).get('/v1/users')).json();
    expect(list.can_invite).toBe(false);
    expect(list.invitations).toHaveLength(1);
    const r = await call(a, owner).post('/v1/users/invitations', { channel: 'email', email: 'fjerde@example.invalid' });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('plan_limit_users');
  });

  it('invitation accept: the invited person verifies the phone by OTP and joins', async () => {
    const { owner } = await createAccount(ctx);
    await call(a, owner).post('/v1/users/invitations', { channel: 'email', email: 'ny@example.invalid' });
    const token = /invite\/([\w-]+)/.exec(ctx.fakes.email.sent[0]!.text)![1]!;
    const sub = '6c1c1f4e-6c2a-4c3e-9a51-0f3c1c6e2b11';
    ctx.fakes.authAdmin.users.set(sub, { id: sub, email: 'ny@example.invalid', email_confirmed: true, phone: '+4790000001', phone_confirmed: true });
    const jwt = await signTestToken(JWT_SECRET, { sub, email: 'ny@example.invalid' });
    expect((await call(a, jwt).get('/v1/me')).statusCode).toBe(403);
    const r = await call(a, jwt).post(`/v1/invitations/${token}/accept`, { name: 'Nina' });
    expect(r.statusCode).toBe(200);
    const me = (await call(a, jwt).get('/v1/me')).json();
    expect(me.user).toMatchObject({ name: 'Nina', role: 'member', phone_verified: true, effective_role: 'member' });
    // Single use.
    expect((await call(a, jwt).post(`/v1/invitations/${token}/accept`, { name: 'Nina' })).statusCode).toBe(404);
  });

  it('A11: removing a user notifies them, revokes sessions and disables devices', async () => {
    const { owner } = await createAccount(ctx);
    const victim = await addUser(ctx, owner.accountId, { name: 'Per' });
    expect((await call(a, victim).get('/v1/me')).statusCode).toBe(200);
    expect((await call(a, owner).delete(`/v1/users/${victim.id}`)).statusCode).toBe(204);
    expect(ctx.fakes.push.sent.map((m) => [m.to.includes(victim.id), m.body])).toEqual([[true, 'Du er fjernet fra kontoen Owner i Varslingsapp.']]);
    expect(ctx.fakes.authAdmin.revoked.has(victim.id)).toBe(true);
    const d = await one<{ disabled_at: Date | null }>(ctx.pool, 'select disabled_at from devices where user_id = $1', [victim.id]);
    expect(d!.disabled_at).not.toBeNull();
    expect((await call(a, victim).get('/v1/me')).statusCode).toBe(403);
  });
});

describe('M1: registration and billing', () => {
  it('a test-mode payment ends with an active account whose owner can sign in', async () => {
    const co = await call(a, null).post('/v1/billing/checkout-session', { plan_key: 'familie', locale: 'nb' });
    expect(co.statusCode).toBe(200);
    const session = ctx.fakes.payment.sessions[0]!;
    const token = session.successUrl.split('/register/')[1]!;
    expect(session.metadata.claim).not.toContain(token);

    // Before the webhook arrives, the claim is not yet known.
    expect((await call(a, null).get(`/v1/claim/${token}`)).statusCode).toBe(404);
    const event = { id: 'evt_1', type: 'checkout.completed', sessionId: session.id, customerId: 'cus_1', subscriptionId: 'sub_1', email: 'kjoper@example.invalid', planKey: 'familie', claimEnc: session.metadata.claim };
    const hook = (body: unknown, sig = 'fake-valid') =>
      a.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, payload: JSON.stringify(body) });
    expect((await hook(event, 'bad')).statusCode).toBe(400);
    expect((await hook(event)).json().result).toBe('processed');
    expect((await hook(event)).json().result).toBe('duplicate');
    expect(ctx.fakes.email.sent[0]!.text).toContain(`/register/${token}`);

    const claim = (await call(a, null).get(`/v1/claim/${token}`)).json();
    expect(claim).toMatchObject({ email: 'kjoper@example.invalid', plan: { key: 'familie' } });

    const sub = '0b8c8f7e-1d3b-4f6e-8a0c-2c9e5d7f1a22';
    const jwt = await signTestToken(JWT_SECRET, { sub, email: 'kjoper@example.invalid' });
    const body = { kind: 'company', legal_name: 'Hytteeier AS', org_number: '123456789', owner_name: 'Kari Nordmann', accept_terms: true, confirm_adult: true };
    // Phone must be verified by OTP first.
    expect((await call(a, jwt).post(`/v1/claim/${token}/complete`, body)).json().code).toBe('phone_not_verified');
    ctx.fakes.authAdmin.users.set(sub, { id: sub, email: 'kjoper@example.invalid', email_confirmed: true, phone: '+4791111111', phone_confirmed: true });
    // Under 18 is blocked.
    expect((await call(a, jwt).post(`/v1/claim/${token}/complete`, { ...body, confirm_adult: false })).statusCode).toBe(400);
    // Company without org number is refused.
    expect((await call(a, jwt).post(`/v1/claim/${token}/complete`, { ...body, org_number: undefined })).statusCode).toBe(400);
    expect((await call(a, jwt).post(`/v1/claim/${token}/complete`, body)).statusCode).toBe(200);
    const me = (await call(a, jwt).get('/v1/me')).json();
    expect(me.user).toMatchObject({ role: 'owner', phone_e164: '+4791111111', phone_verified: true });
    expect(me.account).toMatchObject({ status: 'active', kind: 'company', legal_name: 'Hytteeier AS', plan: { key: 'familie' } });
    // Single use.
    expect((await call(a, null).get(`/v1/claim/${token}`)).statusCode).toBe(404);
  });

  it('failed payment -> past_due and owner told; paid -> active; subscription deleted -> canceled', async () => {
    const { owner, accountId } = await createAccount(ctx);
    const subId = (await one<{ s: string }>(ctx.pool, 'select stripe_subscription_id as s from accounts where id = $1', [accountId]))!.s;
    const hook = (body: unknown) => a.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': 'fake-valid' }, payload: JSON.stringify(body) });
    await hook({ id: 'evt_f', type: 'invoice.payment_failed', subscriptionId: subId });
    await ctx.drain();
    let acc = (await call(a, owner).get('/v1/account')).json();
    expect([acc.status, acc.alerts_paused]).toEqual(['past_due', false]);
    expect(infoBodies()[0]).toContain('Betalingen for Varslingsapp feilet');
    await ctx.pool.query("update accounts set past_due_since = now() - interval '8 days'");
    expect((await call(a, owner).get('/v1/account')).json().alerts_paused).toBe(true);
    await hook({ id: 'evt_p', type: 'invoice.paid', subscriptionId: subId });
    acc = (await call(a, owner).get('/v1/account')).json();
    expect(acc.status).toBe('active');
    await hook({ id: 'evt_u', type: 'subscription.updated', subscriptionId: subId, priceId: 'price_bedrift', status: 'active', cancelAtPeriodEnd: false });
    expect((await call(a, owner).get('/v1/account')).json().plan.key).toBe('bedrift');
    await hook({ id: 'evt_d', type: 'subscription.deleted', subscriptionId: subId });
    expect((await call(a, owner).get('/v1/account')).json().status).toBe('canceled');
  });

  it('a downgrade below current usage is refused', async () => {
    const { owner } = await createAccount(ctx, { plan: 'familie' });
    for (let i = 0; i < 4; i++) await call(a, owner).post('/v1/objects', { type_key: 'boat', location: point });
    const r = await call(a, owner).post('/v1/billing/change-plan', { plan_key: 'basis' });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('downgrade_below_usage');
    expect(ctx.fakes.payment.planChanges).toHaveLength(0);
  });
});

describe('account deletion, erasure and retention', () => {
  it('deletion cancels the subscription, locks everyone out, and erasure removes personal data', async () => {
    const { owner, accountId } = await createAccount(ctx);
    const member = await addUser(ctx, accountId);
    await call(a, owner).post('/v1/objects', { nickname: 'Hjemme', type_key: 'private_home', location: point });
    expect((await call(a, owner).post('/v1/account/deletion-request', { confirm: true })).statusCode).toBe(202);
    expect(ctx.fakes.payment.canceled[0]).toMatchObject({ immediately: true });
    expect((await call(a, member).get('/v1/me')).statusCode).toBe(403);
    expect(await runErasure(ctx)).toBe(1);
    const users = await many<{ name: string; email: string | null; phone_e164: string | null }>(ctx.pool, 'select name, email, phone_e164 from users where account_id = $1', [accountId]);
    expect(users.every((u) => u.name === 'slettet' && !u.email && !u.phone_e164)).toBe(true);
    const objs = await many<{ nickname: string | null; geom: unknown; place_label: string | null }>(ctx.pool, 'select nickname, geom, place_label from objects where account_id = $1', [accountId]);
    expect(objs).toEqual([{ nickname: null, geom: null, place_label: null }]);
    expect((await one<{ n: number }>(ctx.pool, 'select count(*)::int as n from devices'))!.n).toBe(0);
    expect(await runErasure(ctx)).toBe(0);
  });

  it('retention deletes notifications older than 13 months and audit rows older than 24', async () => {
    const { accountId } = await createAccount(ctx);
    await ctx.pool.query("insert into audit_log(account_id, action, at) values ($1, 'old', now() - interval '25 months'), ($1, 'new', now())", [accountId]);
    const r = await runRetention(ctx);
    expect(r.audit_log).toBe(1);
  });
});

describe('SMS cap', () => {
  it('warns the owner at 80 %, stops non-RED beyond the cap, and stops RED at three times the cap', async () => {
    const { owner, accountId } = await createAccount(ctx, { plan: 'basis' }); // cap 20
    const send = (red: boolean) => sendSmsWithCap(ctx, { accountId, to: '+4790000000', body: 'x', red });
    for (let i = 0; i < 16; i++) expect((await send(false)).sent).toBe(true);
    await ctx.drain();
    expect(infoBodies()).toEqual(['Kontoen har brukt 80 % av månedens SMS-kvote.']);
    for (let i = 0; i < 4; i++) await send(false);
    expect(await send(false)).toEqual({ sent: false, reason: 'cap' });
    for (let i = 0; i < 40; i++) expect((await send(true)).sent).toBe(true);
    expect(await send(true)).toEqual({ sent: false, reason: 'hard_ceiling' });
    expect(ctx.opsAlerts).toContain('sms hard ceiling reached');
    await ctx.drain();
    expect(infoBodies()).toHaveLength(1); // warned once per month
    expect((await call(a, owner).get('/v1/account')).json().usage.sms_this_month).toBe(60);
  });
});

describe('devices and settings', () => {
  it('registers a push token, removes it on logout, and updates channel preferences', async () => {
    const { owner } = await createAccount(ctx);
    const reg = await call(a, owner).post('/v1/me/devices', { platform: 'android', push_token: 'ExponentPushToken[abcdefghijkl]', app_version: '1.0.0' });
    expect(reg.statusCode).toBe(200);
    expect((await call(a, owner).delete(`/v1/me/devices/${reg.json().id}`)).statusCode).toBe(204);
    const me = (await call(a, owner).patch('/v1/me', { sms_for_all_levels: true, locale: 'en' })).json();
    expect(me.user).toMatchObject({ sms_for_all_levels: true, locale: 'en' });
    expect((await call(a, owner).post('/v1/me/test-notification')).statusCode).toBe(204);
    expect(ctx.fakes.push.sent.at(-1)!.body).toBe('Test notification from Varslingsapp');
  });

  it('only +47 numbers are trusted after OTP verification in Supabase', async () => {
    const { owner } = await createAccount(ctx, { phone: false });
    ctx.fakes.authAdmin.users.set(owner.id, { id: owner.id, email: null, email_confirmed: false, phone: '+4790000099', phone_confirmed: true });
    expect((await call(a, owner).post('/v1/me/phone/refresh')).json()).toEqual({ phone_e164: '+4790000099', phone_verified: true });
    ctx.fakes.authAdmin.users.set(owner.id, { id: owner.id, email: null, email_confirmed: false, phone: '+4670000099', phone_confirmed: true });
    expect((await call(a, owner).post('/v1/me/phone/refresh')).statusCode).toBe(400);
  });
});
