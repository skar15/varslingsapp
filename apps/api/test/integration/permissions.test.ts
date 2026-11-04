import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { one } from '../../src/db/client';
import { PERMISSIONS } from '../../src/domain/permissions';
import { addUser, app, boxAround, call, createAccount, makeCtx, PLACES, resetDb, type TestCtx, type TestUser } from '../helpers/ctx';
import { ingestXml, metCap } from '../helpers/pipeline';

let ctx: TestCtx;
let a: FastifyInstance;
let owner: TestUser;
let delegate: TestUser;
let member: TestUser;
let objectId: string;

const point = { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } };

beforeAll(async () => {
  ctx = makeCtx();
  a = await app(ctx);
});

beforeEach(async () => {
  await resetDb();
  ctx.jobs.jobs = [];
  ({ owner } = await createAccount(ctx, { plan: 'bedrift' }));
  delegate = await addUser(ctx, owner.accountId, { delegate: true, name: 'Delegat' });
  member = await addUser(ctx, owner.accountId, { name: 'Medlem' });
  const r = await call(a, owner).post('/v1/objects', { nickname: 'Hytta', type_key: 'holiday_home', location: point });
  expect(r.statusCode).toBe(201);
  objectId = r.json().id;
});

const roles = () => ({ owner, delegate, member });
type Role = 'owner' | 'delegate' | 'member';
const ok = (code: number) => code >= 200 && code < 300;

describe('permission table (every row has a test)', () => {
  it('the table matches the spec', () => {
    expect(PERMISSIONS).toMatchObject({
      view: ['owner', 'delegate', 'member'], ack: ['owner', 'delegate', 'member'], set_status: ['owner', 'delegate', 'member'],
      manage_objects: ['owner', 'delegate'], delete_objects: ['owner'], set_normal_status: ['owner'], manage_users: ['owner'], delegate: ['owner'], billing: ['owner'],
    });
  });

  it.each<[Role, boolean]>([['owner', true], ['delegate', true], ['member', true]])('view dashboard, objects and alerts: %s -> %s', async (role, allowed) => {
    const u = roles()[role];
    for (const url of ['/v1/objects', `/v1/objects/${objectId}`, '/v1/alerts', '/v1/users', '/v1/reference', '/v1/me', '/v1/account']) {
      expect(ok((await call(a, u).get(url)).statusCode), url).toBe(allowed);
    }
  });

  it.each<[Role, boolean]>([['owner', true], ['delegate', true], ['member', true]])('acknowledge alerts: %s -> %s', async (role, allowed) => {
    await ingestXml(ctx, 'met', metCap({ eventType: 'wind', colour: 'yellow', polygon: boxAround(...PLACES.bjornvika) }).xml);
    const u = roles()[role];
    const n = await one<{ id: string }>(ctx.pool, 'select id from notifications where user_id = $1', [u.id]);
    expect(ok((await call(a, u).post(`/v1/notifications/${n!.id}/ack`)).statusCode)).toBe(allowed);
  });

  it.each<[Role, boolean]>([['owner', true], ['delegate', true], ['member', true]])('change status temporarily: %s -> %s', async (role, allowed) => {
    const r = await call(a, roles()[role]).put(`/v1/objects/${objectId}/status`, { status_key: 'loose_items', until: '2026-11-05T12:00:00Z' });
    expect(ok(r.statusCode)).toBe(allowed);
  });

  it.each<[Role, boolean]>([['owner', true], ['delegate', true], ['member', false]])('add objects and change settings: %s -> %s', async (role, allowed) => {
    const u = roles()[role];
    const create = await call(a, u).post('/v1/objects', { nickname: 'Båten', type_key: 'boat', location: point });
    const patch = await call(a, u).patch(`/v1/objects/${objectId}`, { nickname: 'Nytt navn' });
    const sit = await call(a, u).put(`/v1/objects/${objectId}/situations`, { situations: [{ situation_key: 'wind', sensitivity: 'low' }] });
    for (const r of [create, patch, sit]) {
      expect(ok(r.statusCode)).toBe(allowed);
      if (!allowed) expect(r.json().code).toBe('proposal_required');
    }
  });

  it.each<[Role, boolean]>([['owner', true], ['delegate', false], ['member', false]])('delete objects: %s -> %s', async (role, allowed) => {
    expect(ok((await call(a, roles()[role]).delete(`/v1/objects/${objectId}`)).statusCode)).toBe(allowed);
  });

  it.each<[Role, boolean]>([['owner', true], ['delegate', false], ['member', false]])('change what counts as normal: %s -> %s', async (role, allowed) => {
    expect(ok((await call(a, roles()[role]).put(`/v1/objects/${objectId}/normal-status`, { status_key: 'unattended' })).statusCode)).toBe(allowed);
  });

  it.each<[Role, boolean]>([['owner', true], ['delegate', false], ['member', false]])('add and remove users: %s -> %s', async (role, allowed) => {
    const u = roles()[role];
    const victim = await addUser(ctx, owner.accountId, { name: 'Offer' });
    expect(ok((await call(a, u).post('/v1/users/invitations', { channel: 'email', email: 'ny@example.invalid' })).statusCode)).toBe(allowed);
    expect(ok((await call(a, u).delete(`/v1/users/${victim.id}`)).statusCode)).toBe(allowed);
  });

  it.each<[Role, boolean]>([['owner', true], ['delegate', false], ['member', false]])('delegate rights: %s -> %s', async (role, allowed) => {
    expect(ok((await call(a, roles()[role]).patch(`/v1/users/${member.id}/rights`, { can_manage_objects: true })).statusCode)).toBe(allowed);
  });

  it.each<[Role, boolean]>([['owner', true], ['delegate', false], ['member', false]])('plan, invoices, cancel, delete account: %s -> %s', async (role, allowed) => {
    const u = roles()[role];
    expect(ok((await call(a, u).post('/v1/billing/portal-session')).statusCode)).toBe(allowed);
    expect(ok((await call(a, u).post('/v1/billing/change-plan', { plan_key: 'bedrift' })).statusCode)).toBe(allowed);
    expect(ok((await call(a, u).post('/v1/account/deletion-request', { confirm: true })).statusCode)).toBe(allowed);
  });

  it('the owner cannot be removed and cannot remove themselves', async () => {
    expect((await call(a, owner).delete(`/v1/users/${owner.id}`)).json().code).toBe('cannot_remove_self');
  });

  it('requests without a valid token are refused', async () => {
    expect((await call(a, null).get('/v1/objects')).statusCode).toBe(401);
    expect((await call(a, 'not-a-jwt').get('/v1/objects')).statusCode).toBe(401);
  });
});

describe('A12: any endpoint called with another account\'s ids is refused', () => {
  it('objects, statuses, alerts, notifications, users, proposals', async () => {
    const other = await createAccount(ctx);
    const outsider = other.owner;
    await ingestXml(ctx, 'met', metCap({ eventType: 'wind', colour: 'yellow', polygon: boxAround(...PLACES.bjornvika) }).xml);
    const alert = await one<{ id: string }>(ctx.pool, 'select id from alerts limit 1');
    const notification = await one<{ id: string }>(ctx.pool, 'select id from notifications where user_id = $1', [owner.id]);
    const proposal = (await call(a, member).post('/v1/proposals', { kind: 'object_update', target_id: objectId, payload: { nickname: 'x' } })).json();
    const o = call(a, outsider);
    const attempts = [
      await o.get(`/v1/objects/${objectId}`),
      await o.patch(`/v1/objects/${objectId}`, { nickname: 'hijack' }),
      await o.delete(`/v1/objects/${objectId}`),
      await o.put(`/v1/objects/${objectId}/situations`, { situations: [] }),
      await o.put(`/v1/objects/${objectId}/status`, { status_key: 'loose_items', until: '2026-11-05T12:00:00Z' }),
      await o.post(`/v1/objects/${objectId}/status/extend`, { until: '2026-11-05T12:00:00Z' }),
      await o.put(`/v1/objects/${objectId}/normal-status`, { status_key: 'unattended' }),
      await o.get(`/v1/objects/${objectId}/forecast`),
      await o.get(`/v1/alerts/${alert!.id}`),
      await o.post(`/v1/notifications/${notification!.id}/ack`),
      await o.delete(`/v1/users/${member.id}`),
      await o.patch(`/v1/users/${member.id}/rights`, { can_manage_objects: true }),
      await o.post(`/v1/proposals/${proposal.id}/approve`),
      await o.post(`/v1/proposals/${proposal.id}/reject`),
    ];
    for (const r of attempts) expect([403, 404]).toContain(r.statusCode);
    expect((await o.get('/v1/objects')).json().items).toHaveLength(0);
    expect((await o.get('/v1/alerts')).json().items).toHaveLength(0);
    expect((await o.get('/v1/users')).json().items.map((u: { id: string }) => u.id)).toEqual([outsider.id]);
    expect((await o.get('/v1/proposals')).json().items).toHaveLength(0);
    const unchanged = await one<{ nickname: string; deleted_at: Date | null }>(ctx.pool, 'select nickname, deleted_at from objects where id = $1', [objectId]);
    expect(unchanged).toEqual({ nickname: 'Hytta', deleted_at: null });
  });
});
