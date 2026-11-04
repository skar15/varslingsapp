import { randomUUID } from 'node:crypto';
import type { schemas } from '@varsling/shared';
import type { z } from 'zod';
import type { Ctx } from '../context';
import { one } from '../db/client';
import { buildCap } from '../sources/cap';
import { processSourceAlert } from './ingest';

const SEVERITY: Record<string, string> = { yellow: 'Moderate', orange: 'Severe', red: 'Extreme' };
const AWARENESS: Record<string, string> = { yellow: '2; yellow; Moderate', orange: '3; orange; Severe', red: '4; red; Extreme' };

/**
 * Dev and staging only: creates a synthetic CAP alert and runs it through the same pipeline
 * as real warnings (stored under source "sim").
 */
export async function simulateAlert(ctx: Ctx, input: z.infer<typeof schemas.SimulateAlert>): Promise<{ source_id: string; reference: string; alert_id: string | null }> {
  const identifier = `sim-${randomUUID()}`;
  const sent = ctx.now().toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const onset = input.onset ?? ctx.now().toISOString();
  const expires = input.expires ?? new Date(ctx.now().getTime() + 12 * 3_600_000).toISOString();
  const polygons = input.geometry.type === 'Polygon' ? [input.geometry.coordinates[0]!] : input.geometry.coordinates.map((p) => p[0]!);
  const xml = buildCap({
    identifier,
    sender: 'simulator@varslingsapp',
    sent,
    msgType: input.msg_type,
    references: input.references,
    event: input.event,
    eventType: input.event,
    responseType: input.response_type ?? (input.msg_type === 'Cancel' ? 'None' : 'Prepare'),
    severity: input.msg_type === 'Cancel' || input.response_type === 'AllClear' ? 'Minor' : SEVERITY[input.source_level]!,
    awarenessLevel: AWARENESS[input.source_level],
    onset,
    expires,
    headline: input.headline ?? `Testvarsel: ${input.event}`,
    description: 'Simulert varsel for test. Ikke et ekte farevarsel.',
    polygons: polygons as [number, number][][],
  });
  const row = await one<{ id: string }>(ctx.pool, `insert into source_alerts(source, source_id, payload) values ('sim', $1, $2) returning id`, [identifier, { xml }]);
  const alertId = await processSourceAlert(ctx, row!.id);
  return { source_id: identifier, reference: `simulator@varslingsapp,${identifier},${sent}`, alert_id: alertId };
}
