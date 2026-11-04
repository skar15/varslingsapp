import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema';
import { many } from '../../src/db/client';
import { app, boxAround, call, createAccount, makeCtx, PLACES, resetDb, testEnv } from '../helpers/ctx';

beforeEach(async () => {
  await resetDb();
});

describe('schema', () => {
  it('every Drizzle table and column exists in the migrated database', async () => {
    const cols = await many<{ table_name: string; column_name: string }>(
      makeCtx().pool, `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );
    const have = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
    const tables = Object.values(schema).filter((t) => is(t, PgTable)) as PgTable[];
    expect(tables.length).toBeGreaterThan(20);
    for (const t of tables) for (const c of Object.values(getTableColumns(t))) expect(have, `${getTableName(t)}.${c.name}`).toContain(`${getTableName(t)}.${c.name}`);
  });

  it('row-level security is enabled on every table, with no policies', async () => {
    const ctx = makeCtx();
    const off = await many(ctx.pool, `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and relname not in ('spatial_ref_sys', 'schema_migrations')`);
    expect(off).toEqual([]);
    expect(await many(ctx.pool, `select * from pg_policies where schemaname = 'public'`)).toEqual([]);
  });
});

describe('admin and docs', () => {
  it('simulate-alert is not registered in production', async () => {
    const ctx = makeCtx({ env: testEnv({ APP_ENV: 'production' }) });
    const a = await app(ctx);
    const r = await a.inject({ method: 'POST', url: '/v1/admin/simulate-alert', headers: { 'x-admin-key': 'admin-test-key' }, payload: {} });
    expect(r.statusCode).toBe(404);
    const doc = (await call(a, null).get('/v1/openapi.json')).json();
    expect(Object.keys(doc.paths)).not.toContain('/v1/admin/simulate-alert');
  });

  it('simulate-alert runs a synthetic alert through the real pipeline in dev/staging', async () => {
    const ctx = makeCtx();
    const a = await app(ctx);
    const { owner } = await createAccount(ctx);
    await call(a, owner).post('/v1/objects', { nickname: 'Hytta', type_key: 'holiday_home', location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.oslo } } });
    const body = { geometry: { type: 'Polygon', coordinates: [boxAround(...PLACES.oslo)] }, event: 'wind', source_level: 'orange' };
    expect((await a.inject({ method: 'POST', url: '/v1/admin/simulate-alert', headers: { 'x-admin-key': 'wrong-key-wrong' }, payload: body })).statusCode).toBe(401);
    const r = await a.inject({ method: 'POST', url: '/v1/admin/simulate-alert', headers: { 'x-admin-key': 'admin-test-key' }, payload: body });
    expect(r.statusCode).toBe(201);
    await ctx.drain();
    expect(ctx.fakes.push.sent[0]!.title).toBe('Rødt varsel: Vindstyrke – Hytta');
    const detail = (await call(a, owner).get(`/v1/alerts/${r.json().alert_id}`)).json();
    expect(detail).toMatchObject({ issuer: 'TEST', level: 'red', source_level: 'orange', notification: { acked_at: null } });
    expect(detail.objects[0].advice).toEqual(['Sikre utemøbler, trampoliner og andre løse gjenstander.']);
  });

  it('serves an OpenAPI document generated from the zod schemas', async () => {
    const a = await app(makeCtx());
    const doc = (await call(a, null).get('/v1/openapi.json')).json();
    expect(doc.openapi).toBe('3.1.0');
    for (const p of ['/v1/objects', '/v1/objects/{id}/status', '/v1/notifications/{id}/ack', '/v1/claim/{token}/complete', '/v1/proposals/{id}/approve']) {
      expect(Object.keys(doc.paths)).toContain(p);
    }
  });

  it('errors are problem+json', async () => {
    const a = await app(makeCtx());
    const r = await call(a, null).post('/v1/billing/checkout-session', { plan_key: 1 });
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.json()).toMatchObject({ status: 400, code: 'validation_error' });
  });

  it('reference data has an ETag', async () => {
    const ctx = makeCtx();
    const a = await app(ctx);
    const { owner } = await createAccount(ctx);
    const r = await call(a, owner).get('/v1/reference');
    expect(r.json().situation_types.find((s: { key: string }) => s.key === 'wave_height').available).toBe(false);
    const again = await a.inject({ method: 'GET', url: '/v1/reference', headers: { authorization: `Bearer ${owner.token}`, 'if-none-match': r.headers.etag as string } });
    expect(again.statusCode).toBe(304);
  });
});

describe('object validation', () => {
  it('enforces type rules, the area cap, the object limit and Norway-only locations', async () => {
    const ctx = makeCtx();
    const a = await app(ctx);
    const { owner } = await createAccount(ctx, { plan: 'basis' });
    const c = call(a, owner);
    expect((await c.post('/v1/objects', { type_key: 'other', location: { kind: 'none' } })).json().code).toBe('situations_required');
    expect((await c.post('/v1/objects', { type_key: 'other', situations: [{ situation_key: 'wave_height', sensitivity: 'high' }] })).json().code).toBe('invalid_situation');
    const big = { kind: 'area', geometry: { type: 'Polygon', coordinates: [boxAround(15, 68, 1)] } };
    expect((await c.post('/v1/objects', { type_key: 'boat', location: big })).json()).toMatchObject({ code: 'geometry_area', i18n_key: 'geo.error.area' });
    expect((await c.post('/v1/objects', { type_key: 'boat', location: { kind: 'point', geometry: { type: 'Point', coordinates: [2.35, 48.85] } } })).json().code).toBe('geometry_outsideNorway');
    // No type, no nickname: display name falls back; municipality is filled.
    const id = (await c.post('/v1/objects', { location: { kind: 'point', geometry: { type: 'Point', coordinates: PLACES.andenes } } })).json().id;
    const o = (await c.get(`/v1/objects/${id}`)).json();
    expect(o).toMatchObject({ display_name: 'Objekt', municipality_no: '5512', type_key: null });
    expect(o.monitored).toHaveLength(9);
    await c.post('/v1/objects', { type_key: 'boat' });
    await c.post('/v1/objects', { type_key: 'boat' });
    const r = await c.post('/v1/objects', { type_key: 'boat' });
    expect([r.statusCode, r.json().code]).toEqual([409, 'plan_limit_objects']);
  });
});
