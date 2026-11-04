import { beforeEach, describe, expect, it } from 'vitest';
import { many, one } from '../../src/db/client';
import { pollSource } from '../../src/domain/ingest';
import { MetAlertsSource } from '../../src/sources/met-alerts';
import { NveSource } from '../../src/sources/nve';
import { app, call, makeCtx, resetDb, testEnv, type TestCtx } from '../helpers/ctx';
import { fixture } from '../helpers/pipeline';

interface Req {
  url: string;
  headers: Record<string, string>;
}

/** Stub HTTP for MET: no test touches the network (rule 5). */
function metStub(opts: { status?: number; expires?: Date; lastModified?: string } = {}) {
  const requests: Req[] = [];
  const rss = fixture('met/current.rss');
  const fetchFn = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
    if (url.endsWith('current.rss')) {
      const status = opts.status ?? 200;
      const headers: Record<string, string> = {};
      if (opts.expires) headers.expires = opts.expires.toUTCString();
      if (opts.lastModified) headers['last-modified'] = opts.lastModified;
      return new Response(status === 200 ? rss : null, { status, headers });
    }
    const id = new URL(url).searchParams.get('cap')!;
    const n = Number(id.split('.').pop());
    const events = ['wind', 'gale', 'rain', 'rainFlood', 'snow', 'blowingSnow', 'ice', 'icing', 'lightning', 'stormSurge', 'polarLow', 'forestFire', 'avalanches'];
    return new Response(fixture(`met/${events[n - 1]}.xml`), { status: 200 });
  };
  return { requests, fetchFn, opts };
}

let ctx: TestCtx;
beforeEach(async () => {
  await resetDb();
});

function met(stub: ReturnType<typeof metStub>, userAgent: string | null = 'varslingsapp-test/1.0 test@example.invalid') {
  return new MetAlertsSource({ userAgent: userAgent ?? undefined, listUrl: 'https://api.met.test/weatherapi/metalerts/2.0/current.rss', pollIntervalSec: 600, fetch: stub.fetchFn });
}

describe('MET polling', () => {
  it('sends the configured User-Agent, fetches each CAP once, and writes ingest_runs', async () => {
    const stub = metStub({ lastModified: 'Thu, 05 Nov 2026 07:59:00 GMT' });
    const source = met(stub);
    ctx = makeCtx({ sources: [source] });
    const r = await pollSource(ctx, source);
    expect(r).toEqual({ seen: 13, new: 13 });
    expect(stub.requests.every((q) => q.headers['user-agent'] === 'varslingsapp-test/1.0 test@example.invalid')).toBe(true);
    await ctx.drain();
    expect((await one<{ n: number }>(ctx.pool, 'select count(*)::int as n from alerts'))!.n).toBe(13);
    expect(ctx.fakes.heartbeat.pings).toEqual(['met']);

    // Second poll after the interval: conditional request, and no CAP fetched twice.
    ctx.clock.now = new Date(ctx.now().getTime() + 601_000);
    stub.requests.length = 0;
    await pollSource(ctx, source);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.headers['if-modified-since']).toBe('Thu, 05 Nov 2026 07:59:00 GMT');
    const runs = await many<{ ok: boolean; items_new: number }>(ctx.pool, 'select ok, items_new from ingest_runs order by id');
    expect(runs).toEqual([{ ok: true, items_new: 13 }, { ok: true, items_new: 0 }]);
  });

  it('never polls more than once per 10 minutes and never before Expires', async () => {
    const stub = metStub({ expires: new Date('2026-11-05T08:30:00Z') });
    const source = met(stub);
    ctx = makeCtx({ sources: [source] });
    await pollSource(ctx, source);
    ctx.clock.now = new Date('2026-11-05T08:05:00Z');
    expect((await pollSource(ctx, source)).skipped).toBe('not_due');
    ctx.clock.now = new Date('2026-11-05T08:15:00Z'); // interval passed, Expires not yet
    expect((await pollSource(ctx, source)).skipped).toBe('not_due');
    ctx.clock.now = new Date('2026-11-05T08:30:01Z');
    expect((await pollSource(ctx, source)).skipped).toBeUndefined();
    expect(stub.requests.filter((q) => q.url.endsWith('current.rss'))).toHaveLength(2);
  });

  it('a 304 is a successful, empty run', async () => {
    const stub = metStub({ status: 304 });
    const source = met(stub);
    ctx = makeCtx({ sources: [source] });
    expect(await pollSource(ctx, source)).toEqual({ seen: 0, new: 0 });
    expect((await one<{ ok: boolean; not_modified: boolean }>(ctx.pool, 'select ok, not_modified from ingest_runs'))).toEqual({ ok: true, not_modified: true });
  });

  it('backs off on 429', async () => {
    const stub = metStub({ status: 429 });
    const source = met(stub);
    ctx = makeCtx({ sources: [source] });
    expect((await pollSource(ctx, source)).skipped).toBe('rate_limited');
    const st = await one<{ next_poll_after: Date }>(ctx.pool, 'select next_poll_after from source_state');
    expect(st!.next_poll_after.getTime() - ctx.now().getTime()).toBeGreaterThanOrEqual(1200_000);
  });

  it('never calls MET without MET_USER_AGENT (rule 10), and reports it', async () => {
    const stub = metStub();
    const source = met(stub, null);
    ctx = makeCtx({ sources: [source], env: testEnv({ MET_USER_AGENT: undefined as unknown as string }) });
    expect((await pollSource(ctx, source)).skipped).toBe('disabled');
    expect(stub.requests).toHaveLength(0);
    const run = await one<{ ok: boolean; error: string }>(ctx.pool, 'select ok, error from ingest_runs');
    expect(run!.ok).toBe(false);
    expect(run!.error).toContain('MET_USER_AGENT');
  });

  it('health/ingest reports age and staleness per source', async () => {
    const stub = metStub();
    const source = met(stub);
    ctx = makeCtx({ sources: [source] });
    const a = await app(ctx);
    expect((await call(a, null).get('/v1/health/ingest')).statusCode).toBe(503);
    await pollSource(ctx, source);
    const h = await call(a, null).get('/v1/health/ingest');
    expect(h.statusCode).toBe(200);
    expect(h.json().sources[0]).toMatchObject({ source: 'met', stale: false, age_seconds: 0 });
    ctx.clock.now = new Date(ctx.now().getTime() + 31 * 60_000);
    expect((await call(a, null).get('/v1/health/ingest')).statusCode).toBe(503);
  });
});

describe('NVE polling', () => {
  it('lists the feed for a date range and fetches each CAP by id', async () => {
    const urls: string[] = [];
    const fetchFn = async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/Cap/Feed/')) return new Response(fixture('nve/flood-feed.json'), { headers: { 'content-type': 'application/json' } });
      return new Response(fixture('nve/flood.xml'));
    };
    const source = new NveSource('nve-flood', { baseUrl: 'https://nve.test/api', pollIntervalSec: 600, enabled: true, fetch: fetchFn });
    ctx = makeCtx({ sources: [source] });
    expect(await pollSource(ctx, source)).toEqual({ seen: 1, new: 1 });
    expect(urls[0]).toBe('https://nve.test/api/Cap/Feed/2026-11-04/2026-11-08');
    await ctx.drain();
    expect((await one<{ situation_key: string; level: string }>(ctx.pool, 'select situation_key, level from alerts'))).toEqual({ situation_key: 'flood', level: 'yellow' });
  });
});
