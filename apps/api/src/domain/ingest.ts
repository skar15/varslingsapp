import type { Ctx } from '../context';
import { many, one, withTx } from '../db/client';
import { parseCap } from '../sources/cap';
import { RateLimitedError, type AlertSource, type SourceStateRow } from '../sources/types';
import { chainRootFromReferences, normaliseCap } from './normalise';
import { loadReference } from './reference';

/**
 * Stage 1: poll one source. Writes an ingest_runs row, uses conditional requests, honours
 * the poll interval and the Expires header, and fetches each CAP file once.
 */
export async function pollSource(ctx: Ctx, source: AlertSource, opts: { force?: boolean } = {}): Promise<{ skipped?: string; seen: number; new: number }> {
  const now = ctx.now();
  const state =
    (await one<SourceStateRow & { last_success_at: Date | null }>(ctx.pool, 'select last_modified, next_poll_after, last_success_at from source_state where source = $1', [source.key])) ??
    { last_modified: null, next_poll_after: null, last_success_at: null };
  if (!opts.force && state.next_poll_after && state.next_poll_after > now) return { skipped: 'not_due', seen: 0, new: 0 };

  const run = await one<{ id: number }>(ctx.pool, 'insert into ingest_runs(source, started_at) values ($1, $2) returning id', [source.key, now]);
  const finish = (fields: { ok: boolean; notModified?: boolean; seen?: number; new?: number; error?: string }) =>
    ctx.pool.query('update ingest_runs set finished_at = $2, ok = $3, not_modified = $4, items_seen = $5, items_new = $6, error = $7 where id = $1', [
      run!.id, ctx.now(), fields.ok, fields.notModified ?? false, fields.seen ?? 0, fields.new ?? 0, fields.error ?? null,
    ]);
  const saveState = (next: Date, lastModified: string | null | undefined, success: boolean) =>
    ctx.pool.query(
      `insert into source_state(source, last_modified, next_poll_after, last_success_at, updated_at) values ($1,$2,$3,$4,now())
       on conflict (source) do update set last_modified = coalesce(excluded.last_modified, source_state.last_modified),
         next_poll_after = excluded.next_poll_after, last_success_at = coalesce(excluded.last_success_at, source_state.last_success_at), updated_at = now()`,
      [source.key, lastModified ?? null, next, success ? ctx.now() : null],
    );

  if (!source.enabled) {
    await finish({ ok: false, error: source.disabledReason ?? 'source disabled' });
    await saveState(new Date(now.getTime() + source.pollIntervalSec * 1000), null, false);
    return { skipped: 'disabled', seen: 0, new: 0 };
  }

  const intervalNext = new Date(now.getTime() + source.pollIntervalSec * 1000);
  try {
    const feed = await source.list(state, now);
    const next = feed.expiresAt && feed.expiresAt > intervalNext ? feed.expiresAt : intervalNext;
    let created = 0;
    if (!feed.notModified && feed.items.length) {
      const known = new Set(
        (await many<{ source_id: string }>(ctx.pool, 'select source_id from source_alerts where source = $1 and source_id = any($2)', [source.key, feed.items.map((i) => i.sourceId)])).map((r) => r.source_id),
      );
      for (const item of feed.items) {
        if (known.has(item.sourceId)) continue;
        const xml = await source.fetchCap(item);
        const row = await one<{ id: string }>(
          ctx.pool,
          `insert into source_alerts(source, source_id, url, payload, fetched_at) values ($1,$2,$3,$4,$5)
           on conflict (source, source_id) do nothing returning id`,
          [source.key, item.sourceId, item.url, { xml }, ctx.now()],
        );
        if (row) {
          created++;
          await ctx.jobs.send('alert.process', { sourceAlertId: row.id });
        }
      }
    }
    await finish({ ok: true, notModified: feed.notModified, seen: feed.items.length, new: created });
    await saveState(next, feed.lastModified, true);
    await ctx.providers.heartbeat.ping(source.key);
    ctx.log.info({ source: source.key, seen: feed.items.length, new: created, notModified: feed.notModified }, 'ingest run');
    return { seen: feed.items.length, new: created };
  } catch (err) {
    const rateLimited = err instanceof RateLimitedError;
    const backoffSec = rateLimited ? Math.max(err.retryAfterSec ?? 0, source.pollIntervalSec * 2) : source.pollIntervalSec;
    await finish({ ok: false, error: (err as Error).message.slice(0, 500) });
    await saveState(new Date(now.getTime() + backoffSec * 1000), null, false);
    ctx.log.error({ source: source.key, err: (err as Error).message }, 'ingest run failed');
    return { skipped: rateLimited ? 'rate_limited' : 'error', seen: 0, new: 0 };
  }
}

/**
 * Stages 2 and 3: normalise one stored CAP file and apply its lifecycle (supersede, chain root)
 * in one transaction, then queue matching. Safe to replay.
 */
export async function processSourceAlert(ctx: Ctx, sourceAlertId: string): Promise<string | null> {
  const sa = await one<{ id: string; source: string; payload: { xml: string }; fetched_at: Date }>(
    ctx.pool, 'select id, source, payload, fetched_at from source_alerts where id = $1', [sourceAlertId],
  );
  if (!sa) return null;
  const ref = await loadReference(ctx.pool);
  let cap;
  try {
    cap = parseCap(sa.payload.xml);
  } catch (err) {
    await ctx.pool.query('update source_alerts set processed_at = now(), process_error = $2 where id = $1', [sa.id, (err as Error).message.slice(0, 500)]);
    ctx.log.error({ sourceAlertId, err: (err as Error).message }, 'CAP parse failed');
    return null;
  }
  if (cap.status !== 'Actual' && !(cap.status === 'Test' && ['development', 'test'].includes(ctx.env.APP_ENV))) {
    await ctx.pool.query("update source_alerts set processed_at = now(), process_error = 'dropped: status ' || $2 where id = $1", [sa.id, cap.status]);
    return null;
  }
  const n = normaliseCap(cap, sa.source, ref);
  if (!n.situationKey) ctx.log.warn({ metric: 'alert_unmapped_event', source: n.source, event: n.eventKey }, 'unmapped event');

  const alertId = await withTx(ctx.pool, async (db) => {
    const existing = await one<{ id: string }>(db, 'select id from alerts where source = $1 and source_id = $2', [n.source, n.sourceId]);
    if (existing) return existing.id;
    const refIds = n.references.map((r) => r.identifier);
    const referenced = refIds.length
      ? await many<{ id: string; chain_root: string; expires: Date; sent_at: Date }>(
          db, 'select id, chain_root, expires, sent_at from alerts where source = $1 and source_id = any($2) order by sent_at asc', [n.source, refIds],
        )
      : [];
    const chainRoot = referenced[0]?.chain_root ?? chainRootFromReferences(n.sourceId, n.references);
    const latestRef = referenced[referenced.length - 1];
    const expires = n.expires ?? latestRef?.expires?.toISOString() ?? new Date(Date.parse(n.sentAt) + 86_400_000).toISOString();

    let geomSql: string;
    const params: unknown[] = [
      sa.id, n.source, n.sourceId, n.msgType, n.capStatus, n.responseType, n.severity, refIds, chainRoot, n.eventKey, n.situationKey,
      n.sourceLevel, n.level, n.onset, expires, n.sentAt, sa.fetched_at, n.areaNb, n.titleNb, n.titleEn, n.descriptionNb, n.descriptionEn,
      n.instructionNb, n.instructionEn, n.webUrl,
    ];
    if (n.polygons.length) {
      params.push(JSON.stringify(n.polygons.map((ring) => ({ type: 'Polygon', coordinates: [ring] }))));
      // Close rings, union overlapping polygons (overlap = union, no holes) and make valid.
      geomSql = `st_multi(st_collectionextract(st_makevalid(st_unaryunion(st_collect(array(
                   select st_makevalid(st_setsrid(st_geomfromgeojson(p::text), 4326)) from jsonb_array_elements($26::jsonb) p)))), 3))::geography`;
    } else if (latestRef) {
      params.push(latestRef.id);
      geomSql = '(select geom from alerts where id = $26)';
    } else {
      throw new Error(`alert ${n.sourceId} has no polygon and no known reference`);
    }
    const row = await one<{ id: string }>(
      db,
      `insert into alerts(source_alert_id, source, source_id, msg_type, cap_status, response_type, severity, references_ids, chain_root,
         event_key, situation_key, source_level, level, onset, expires, sent_at, fetched_at, area_nb, title_nb, title_en,
         description_nb, description_en, instruction_nb, instruction_en, web_url, geom)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25, ${geomSql})
       on conflict (source, source_id) do nothing returning id`,
      params,
    );
    if (!row) return (await one<{ id: string }>(db, 'select id from alerts where source = $1 and source_id = $2', [n.source, n.sourceId]))!.id;
    // Every referenced alert is superseded by this one.
    if (refIds.length) {
      await db.query('update alerts set superseded_by = $1 where source = $2 and source_id = any($3) and id <> $1', [row.id, n.source, refIds]);
    }
    // Late arrival (replay out of order): a newer alert already references this one.
    await db.query(
      `update alerts set superseded_by = (select id from alerts n where n.source = $2 and $3 = any(n.references_ids) order by n.sent_at desc limit 1)
       where id = $1 and exists (select 1 from alerts n where n.source = $2 and $3 = any(n.references_ids))`,
      [row.id, n.source, n.sourceId],
    );
    return row.id;
  });
  await ctx.pool.query('update source_alerts set processed_at = now(), process_error = null where id = $1', [sa.id]);
  await ctx.jobs.send('alert.match', { alertId });
  return alertId;
}

/** Staleness alarm: no successful poll for an enabled source in 30 minutes pages the operator. */
export async function checkStaleness(ctx: Ctx): Promise<{ source: string; stale: boolean }[]> {
  const rows = await ingestHealth(ctx);
  for (const r of rows) if (r.stale) ctx.opsAlert('stale ingest', { source: r.source, last_success_at: r.last_success_at });
  return rows.map((r) => ({ source: r.source, stale: r.stale }));
}

export async function ingestHealth(ctx: Ctx) {
  const now = ctx.now();
  const states = await many<{ source: string; last_success_at: Date | null }>(ctx.pool, 'select source, last_success_at from source_state');
  const errors = await many<{ source: string; error: string | null }>(
    ctx.pool, `select distinct on (source) source, error from ingest_runs where finished_at is not null order by source, started_at desc`,
  );
  return ctx.sources.map((s) => {
    const st = states.find((x) => x.source === s.key);
    const last = st?.last_success_at ?? null;
    const age = last ? Math.round((now.getTime() - last.getTime()) / 1000) : null;
    return {
      source: s.key,
      enabled: s.enabled,
      last_success_at: last ? last.toISOString() : null,
      age_seconds: age,
      stale: age === null || age > ctx.env.STALE_INGEST_MINUTES * 60,
      last_error: s.enabled ? (errors.find((e) => e.source === s.key)?.error ?? null) : (s.disabledReason ?? 'disabled'),
    };
  });
}
