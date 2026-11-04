import { readFileSync } from 'node:fs';
import path from 'node:path';
import { one } from '../../src/db/client';
import { processSourceAlert } from '../../src/domain/ingest';
import { buildCap, type BuildCapInput } from '../../src/sources/cap';
import type { TestCtx } from './ctx';

export const fixture = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', 'fixtures', rel), 'utf8');

/** Stores a CAP document as if fetched from `source` and runs the pipeline to completion. */
export async function ingestXml(ctx: TestCtx, source: string, xml: string, sourceId?: string): Promise<string | null> {
  const id = sourceId ?? /<identifier>([^<]+)<\/identifier>/.exec(xml)![1]!;
  const row = await one<{ id: string }>(
    ctx.pool,
    `insert into source_alerts(source, source_id, payload, fetched_at) values ($1,$2,$3,$4)
     on conflict (source, source_id) do update set payload = excluded.payload returning id`,
    [source, id, { xml }, ctx.now()],
  );
  const alertId = await processSourceAlert(ctx, row!.id);
  await ctx.drain();
  return alertId;
}

let seq = 0;
const SENDER = 'noreply@met.no';

export interface Msg {
  identifier: string;
  sent: string;
  xml: string;
  ref: string;
}

/** A MET-style CAP message for the given polygon (GeoJSON order). */
export function metCap(p: {
  eventType: string; colour: 'yellow' | 'orange' | 'red'; polygon: [number, number][]; msgType?: 'Alert' | 'Update' | 'Cancel';
  refs?: Msg[]; responseType?: string; polygons?: [number, number][][]; onset?: string; expires?: string; sentOffsetMin?: number;
}): Msg {
  const identifier = `2.49.0.1.578.0.test.${++seq}`;
  const sent = new Date(Date.parse('2026-11-05T07:00:00Z') + (p.sentOffsetMin ?? seq) * 60_000).toISOString();
  const awareness = { yellow: '2; yellow; Moderate', orange: '3; orange; Severe', red: '4; red; Extreme' }[p.colour];
  const clear = p.msgType === 'Cancel' || p.responseType === 'AllClear';
  const input: BuildCapInput = {
    identifier, sender: SENDER, sent, msgType: p.msgType ?? 'Alert', references: (p.refs ?? []).map((r) => r.ref), event: p.eventType, eventType: p.eventType,
    responseType: p.responseType ?? (p.msgType === 'Cancel' ? 'None' : 'Monitor'), severity: clear ? 'Minor' : { yellow: 'Moderate', orange: 'Severe', red: 'Extreme' }[p.colour],
    awarenessLevel: clear ? undefined : awareness, onset: p.onset ?? '2026-11-05T09:00:00Z', expires: p.expires ?? '2026-11-06T09:00:00Z',
    headline: `Test ${p.eventType} ${p.colour}`, polygons: p.polygons ?? [p.polygon],
  };
  return { identifier, sent, xml: buildCap(input), ref: `${SENDER},${identifier},${sent}` };
}
