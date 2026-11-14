import { beforeEach, describe, expect, it } from 'vitest';
import { many, one } from '../../src/db/client';
import { createObject } from '../../src/domain/objects';
import type { Actor } from '../../src/domain/permissions';
import { addUser, app, boxAround, call, createAccount, makeCtx, PLACES, resetDb, type TestCtx, type TestUser } from '../helpers/ctx';
import { fixture, ingestXml, metCap } from '../helpers/pipeline';

let ctx: TestCtx;
const actorFor = (u: TestUser, role: 'owner' | 'member' = 'owner'): Actor => ({
  id: u.id, accountId: u.accountId, role, canManageObjects: false, effective: role === 'owner' ? 'owner' : 'member', locale: 'nb', name: 'Eier',
});

async function notificationsFor(objectId: string) {
  return many<{ user_id: string; level: string; channel: string; kind: string; state: string }>(
    ctx.pool, 'select user_id, level, channel, kind, state from notifications where object_id = $1 order by queued_at, channel', [objectId],
  );
}

const GROVFJORD = boxAround(...PLACES.bjornvika, 0.2);

beforeEach(async () => {
  await resetDb();
  ctx = makeCtx();
});

describe('acceptance A1–A7, A13', () => {
  it('A1: holiday home, wind MEDIUM, yellow warning -> YELLOW push "Tiltak må vurderes", yellow light, no SMS', async () => {
    const { owner } = await createAccount(ctx);
    const member = await addUser(ctx, owner.accountId);
    const id = await createObject(ctx, actorFor(owner), {
      nickname: 'Bjørnvika', type_key: 'holiday_home', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } },
      situations: [{ situation_key: 'wind', sensitivity: 'medium' }],
    });
    await ingestXml(ctx, 'met', fixture('met/wind.xml'));
    const rows = await notificationsFor(id);
    expect(rows.map((r) => [r.level, r.channel]).sort()).toEqual([['yellow', 'push'], ['yellow', 'push']]);
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([owner.id, member.id]));
    expect(ctx.fakes.sms.sent).toHaveLength(0);
    expect(ctx.fakes.push.sent).toHaveLength(2);
    expect(ctx.fakes.push.sent[0]!.title).toBe('Gult varsel: Vindstyrke – Bjørnvika');
    expect(ctx.fakes.push.sent[0]!.body.startsWith('Tiltak må vurderes.')).toBe(true);
    expect(ctx.fakes.push.sent[0]!.channelId).toBe('alert-yellow');
    expect(ctx.fakes.push.sent[0]!.interruptionLevel).toBe('time-sensitive');

    ctx.clock.now = new Date('2026-11-05T10:00:00Z');
    const a = await app(ctx);
    const list = (await call(a, owner).get('/v1/objects')).json();
    expect(list.items[0].light).toBe('yellow');
    expect(list.items[0].summary.situation_key).toBe('wind');
  });

  it('A2: status exterior_work adds precipitation; yellow wind notifies', async () => {
    const { owner } = await createAccount(ctx);
    const id = await createObject(ctx, actorFor(owner), {
      nickname: 'Hjemme der vi bor', type_key: 'private_home', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.andenes } },
      situations: [{ situation_key: 'wind', sensitivity: 'high' }], status_key: 'exterior_work', status_until: '2026-11-10T08:00:00Z',
    });
    await ingestXml(ctx, 'met', metCap({ eventType: 'wind', colour: 'yellow', polygon: boxAround(...PLACES.andenes) }).xml);
    expect((await notificationsFor(id)).map((r) => r.level)).toEqual(['yellow']);
    await ingestXml(ctx, 'met', metCap({ eventType: 'rain', colour: 'yellow', polygon: boxAround(...PLACES.andenes) }).xml);
    expect((await notificationsFor(id)).map((r) => r.level)).toEqual(['yellow', 'yellow']);
  });

  it('A3: LOW sensitivity -> nothing for yellow, RED for orange', async () => {
    const { owner } = await createAccount(ctx);
    const id = await createObject(ctx, actorFor(owner), {
      type_key: 'private_home', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } },
      situations: [{ situation_key: 'wind', sensitivity: 'low' }],
    });
    await ingestXml(ctx, 'met', metCap({ eventType: 'wind', colour: 'yellow', polygon: GROVFJORD }).xml);
    expect(await notificationsFor(id)).toHaveLength(0);
    await ingestXml(ctx, 'met', metCap({ eventType: 'wind', colour: 'orange', polygon: GROVFJORD }).xml);
    const rows = await notificationsFor(id);
    expect(rows.map((r) => [r.level, r.channel])).toEqual([['red', 'push'], ['red', 'sms']]);
    expect(ctx.fakes.sms.sent[0]!.body.startsWith('VARSEL RØD: Vindstyrke')).toBe(true);
  });

  it('A4: object with no location is never matched and the dashboard says so', async () => {
    const { owner } = await createAccount(ctx);
    const id = await createObject(ctx, actorFor(owner), { nickname: 'Uten sted', type_key: 'boat', location: { kind: 'none' } });
    await ingestXml(ctx, 'met', fixture('met/wind.xml'));
    expect(await notificationsFor(id)).toHaveLength(0);
    const a = await app(ctx);
    const o = (await call(a, owner).get(`/v1/objects/${id}`)).json();
    expect(o.location_kind).toBe('none');
    expect(o.light).toBe('none');
  });

  it('A5: yellow, update to orange, same-level update, full replay -> exactly YELLOW then RED', async () => {
    const { owner } = await createAccount(ctx, { phone: false });
    const id = await createObject(ctx, actorFor(owner), {
      type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } },
    });
    const m1 = metCap({ eventType: 'wind', colour: 'yellow', polygon: GROVFJORD });
    const m2 = metCap({ eventType: 'wind', colour: 'orange', polygon: GROVFJORD, msgType: 'Update', refs: [m1] });
    const m3 = metCap({ eventType: 'wind', colour: 'orange', polygon: GROVFJORD, msgType: 'Update', refs: [m1, m2] });
    for (const m of [m1, m2, m3]) await ingestXml(ctx, 'met', m.xml);
    // Replay the whole ingest, in the original order and reversed.
    for (const m of [m1, m2, m3, m3, m2, m1]) await ingestXml(ctx, 'met', m.xml);
    await ctx.pool.query('update source_alerts set processed_at = null');
    const rows = await notificationsFor(id);
    expect(rows.map((r) => r.level)).toEqual(['yellow', 'red']);
    expect(ctx.fakes.push.sent).toHaveLength(2);
    // Supersede chain: only the last message is current, and all share the root.
    const alerts = await many<{ source_id: string; superseded_by: string | null; chain_root: string }>(ctx.pool, 'select source_id, superseded_by, chain_root from alerts order by sent_at');
    expect(alerts.map((a) => !!a.superseded_by)).toEqual([true, true, false]);
    expect(new Set(alerts.map((a) => a.chain_root))).toEqual(new Set([m1.identifier]));
  });

  it('A5b: replay in reverse order on a fresh database still sends no stale notification', async () => {
    const { owner } = await createAccount(ctx, { phone: false });
    const id = await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } } });
    const m1 = metCap({ eventType: 'wind', colour: 'yellow', polygon: GROVFJORD });
    const m2 = metCap({ eventType: 'wind', colour: 'orange', polygon: GROVFJORD, msgType: 'Update', refs: [m1] });
    await ingestXml(ctx, 'met', m2.xml);
    await ingestXml(ctx, 'met', m1.xml);
    expect((await notificationsFor(id)).map((r) => r.level)).toEqual(['red']);
    const first = await one<{ superseded_by: string | null }>(ctx.pool, 'select superseded_by from alerts where source_id = $1', [m1.identifier]);
    expect(first?.superseded_by).not.toBeNull();
  });

  it('A6: cancel after RED -> one "Varsel avlyst" push; downgrade sends nothing', async () => {
    const { owner } = await createAccount(ctx);
    const id = await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } } });
    const m1 = metCap({ eventType: 'wind', colour: 'red', polygon: GROVFJORD });
    const m2 = metCap({ eventType: 'wind', colour: 'yellow', polygon: GROVFJORD, msgType: 'Update', refs: [m1] });
    const m3 = metCap({ eventType: 'wind', colour: 'yellow', polygon: GROVFJORD, msgType: 'Cancel', refs: [m1, m2] });
    await ingestXml(ctx, 'met', m1.xml);
    await ingestXml(ctx, 'met', m2.xml);
    const before = ctx.fakes.push.sent.length;
    await ingestXml(ctx, 'met', m3.xml);
    await ingestXml(ctx, 'met', m3.xml);
    const rows = await notificationsFor(id);
    expect(rows.filter((r) => r.kind === 'cancel')).toHaveLength(1);
    expect(ctx.fakes.push.sent.length - before).toBe(1);
    expect(ctx.fakes.push.sent.at(-1)!.title).toBe('Varsel avlyst: Vindstyrke – Fritidsbåt');
    const cancel = await one<{ level: string | null; msg_type: string }>(ctx.pool, 'select level, msg_type from alerts where source_id = $1', [m3.identifier]);
    expect(cancel).toEqual({ level: null, msg_type: 'cancel' });
  });

  it('A6b: all-clear (Update, AllClear, Minor) after RED also gives one cancel push', async () => {
    const { owner } = await createAccount(ctx);
    await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } } });
    const m1 = metCap({ eventType: 'wind', colour: 'orange', polygon: GROVFJORD });
    const m2 = metCap({ eventType: 'wind', colour: 'yellow', polygon: GROVFJORD, msgType: 'Update', responseType: 'AllClear', refs: [m1] });
    await ingestXml(ctx, 'met', m1.xml);
    await ingestXml(ctx, 'met', m2.xml);
    expect((await many(ctx.pool, "select 1 from notifications where kind = 'cancel'")).length).toBe(1);
  });

  it('A7: unacknowledged RED gets one reminder after 15 minutes; acknowledged does not', async () => {
    const { owner } = await createAccount(ctx);
    const other = await addUser(ctx, owner.accountId);
    await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } } });
    await ingestXml(ctx, 'met', metCap({ eventType: 'wind', colour: 'red', polygon: GROVFJORD }).xml);
    const reminders = ctx.jobs.pending('notify.reminder');
    expect(reminders).toHaveLength(2);
    expect(reminders[0]!.startAfter!.getTime() - ctx.now().getTime()).toBe(15 * 60_000);

    const a = await app(ctx);
    const n = (await call(a, other).get('/v1/notifications')).json();
    const ack = await call(a, other).post(`/v1/notifications/${n.items[0].id}/ack`);
    expect(ack.statusCode).toBe(200);
    // Another user's notification cannot be acknowledged by someone else.
    expect((await call(a, owner).post(`/v1/notifications/${n.items[0].id}/ack`)).statusCode).toBe(404);

    const pushBefore = ctx.fakes.push.sent.length;
    const smsBefore = ctx.fakes.sms.sent.length;
    await ctx.drain({ until: new Date(ctx.now().getTime() + 16 * 60_000) });
    const reminderPushes = ctx.fakes.push.sent.slice(pushBefore);
    expect(reminderPushes).toHaveLength(1);
    expect(reminderPushes[0]!.title).toBe('Påminnelse: rødt varsel for Fritidsbåt er ikke bekreftet');
    expect(reminderPushes[0]!.to).toContain(owner.id);
    expect(ctx.fakes.sms.sent.length - smsBefore).toBe(1);
    // Running it again sends nothing more.
    await ctx.jobs.send('notify.reminder', { notificationId: (await one<{ id: string }>(ctx.pool, 'select id from notifications where user_id = $1 limit 1', [owner.id]))!.id });
    await ctx.drain();
    expect(ctx.fakes.push.sent.length - pushBefore).toBe(1);
  });

  it('A13: CAP lat,lon polygons and overlapping multi-polygon area handled as one union', async () => {
    const { owner } = await createAccount(ctx, { phone: false });
    const inBoth = await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: [16.95, 68.65] } } });
    const inSecondOnly = await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: [17.25, 68.75] } } });
    const outside = await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: [15.0, 68.65] } } });
    const p1: [number, number][] = [[16.8, 68.55], [17.1, 68.55], [17.1, 68.7], [16.8, 68.7], [16.8, 68.55]];
    const p2: [number, number][] = [[16.9, 68.6], [17.3, 68.6], [17.3, 68.8], [16.9, 68.8], [16.9, 68.6]];
    const alertId = await ingestXml(ctx, 'met', metCap({ eventType: 'wind', colour: 'yellow', polygon: p1, polygons: [p1, p2] }).xml);
    const g = await one<{ n: number; valid: boolean; x: number }>(
      ctx.pool, 'select st_numgeometries(geom::geometry) as n, st_isvalid(geom::geometry) as valid, st_x(st_centroid(geom::geometry)) as x from alerts where id = $1', [alertId],
    );
    expect(g).toMatchObject({ n: 1, valid: true });
    expect(g!.x).toBeGreaterThan(16.8);
    expect(g!.x).toBeLessThan(17.3);
    expect(await notificationsFor(inBoth)).toHaveLength(1);
    expect(await notificationsFor(inSecondOnly)).toHaveLength(1);
    expect(await notificationsFor(outside)).toHaveLength(0);
  });

  it('area objects match when the area intersects the warning', async () => {
    const { owner } = await createAccount(ctx, { phone: false });
    const id = await createObject(ctx, actorFor(owner), {
      type_key: 'holiday_home', location: { kind: 'area', geometry: { type: 'Polygon', coordinates: [boxAround(17.45, 68.7, 0.1)] } },
    });
    await ingestXml(ctx, 'met', fixture('met/wind.xml'));
    expect(await notificationsFor(id)).toHaveLength(1);
  });

  it('users without push device get SMS for yellow; sms_for_all_levels also gets SMS', async () => {
    const { owner } = await createAccount(ctx);
    const noDevice = await addUser(ctx, owner.accountId, { device: false });
    const smsAll = await addUser(ctx, owner.accountId, { smsAll: true });
    const id = await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } } });
    await ingestXml(ctx, 'met', fixture('met/wind.xml'));
    const rows = await notificationsFor(id);
    const byUser = (u: string) => rows.filter((r) => r.user_id === u).map((r) => r.channel).sort();
    expect(byUser(owner.id)).toEqual(['push']);
    expect(byUser(noDevice.id)).toEqual(['sms']);
    expect(byUser(smsAll.id)).toEqual(['push', 'sms']);
  });

  it('DeviceNotRegistered disables the device and falls back to SMS', async () => {
    const { owner } = await createAccount(ctx);
    ctx.fakes.push.unregistered.add(`ExponentPushToken[${owner.id}]`);
    const id = await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } } });
    await ingestXml(ctx, 'met', fixture('met/wind.xml'));
    const rows = await notificationsFor(id);
    expect(rows.map((r) => [r.channel, r.state])).toEqual([['push', 'failed'], ['sms', 'sent']]);
    const d = await one<{ disabled_at: Date | null }>(ctx.pool, 'select disabled_at from devices where user_id = $1', [owner.id]);
    expect(d?.disabled_at).not.toBeNull();
  });

  it('alerts pause for past_due beyond the grace period, and resume within it', async () => {
    const { owner } = await createAccount(ctx);
    const id = await createObject(ctx, actorFor(owner), { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } } });
    await ctx.pool.query("update accounts set status = 'past_due', past_due_since = $1::timestamptz - interval '8 days'", [ctx.now()]);
    await ingestXml(ctx, 'met', metCap({ eventType: 'wind', colour: 'yellow', polygon: GROVFJORD }).xml);
    expect(await notificationsFor(id)).toHaveLength(0);
    await ctx.pool.query("update accounts set past_due_since = $1::timestamptz - interval '2 days'", [ctx.now()]);
    await ingestXml(ctx, 'met', metCap({ eventType: 'wind', colour: 'yellow', polygon: GROVFJORD }).xml);
    expect(await notificationsFor(id)).toHaveLength(1);
  });

  it('unmapped events are stored but never notified', async () => {
    const { owner } = await createAccount(ctx);
    const id = await createObject(ctx, actorFor(owner), { type_key: null, location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } } });
    await ingestXml(ctx, 'met', fixture('met/avalanches.xml'));
    expect(await notificationsFor(id)).toHaveLength(0);
    expect((await one<{ situation_key: string | null }>(ctx.pool, 'select situation_key from alerts'))?.situation_key).toBeNull();
  });

  it('replaying every fixture (one per event type) gives the expected alerts and lights', async () => {
    const { owner } = await createAccount(ctx, { phone: false });
    const home = await createObject(ctx, actorFor(owner), { type_key: 'holiday_home', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.bjornvika } } });
    const events = ['wind', 'gale', 'rain', 'rainFlood', 'snow', 'blowingSnow', 'ice', 'icing', 'lightning', 'stormSurge', 'polarLow', 'forestFire', 'avalanches'];
    for (let pass = 0; pass < 2; pass++) {
      for (const e of events) await ingestXml(ctx, 'met', fixture(`met/${e}.xml`));
      await ingestXml(ctx, 'nve-flood', fixture('nve/flood.xml'));
      await ingestXml(ctx, 'nve-landslide', fixture('nve/landslide.xml'));
    }
    expect((await one<{ n: number }>(ctx.pool, 'select count(*)::int as n from alerts'))!.n).toBe(15);
    // holiday_home monitors wind, precipitation, snow, flood, landslide, ice, lightning, forest_fire (not storm_surge).
    const rows = await notificationsFor(home);
    // Each fixture is its own chain. storm_surge is not monitored for a holiday home, and the
    // unmapped avalanche event is never notified: 2 RED (gale, polarLow) + 11 YELLOW, once each.
    expect(rows.filter((r) => r.level === 'red')).toHaveLength(2);
    expect(rows).toHaveLength(13);
    ctx.clock.now = new Date('2026-11-05T13:00:00Z');
    const a = await app(ctx);
    const list = (await call(a, owner).get('/v1/objects')).json();
    expect(list.items[0].light).toBe('red');
  });
});
