import { MAX_DRAWN_CORNERS, schemas } from '@varsling/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { many } from '../../db/client';
import {
  createObject, deleteObject, extendStatus, getObjectRow, loadObjects, objectCanFlags, setNormalStatus, setSituations, setStatus, toSummary, updateObject,
} from '../../domain/objects';
import { loadReference } from '../../domain/reference';
import { iso } from '../../lib/time';
import { AppError } from '../../lib/errors';
import { requireUser } from '../auth';

const IdParams = z.object({ id: schemas.Id });

export async function objectRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = requireUser(ctx);

  r.get('/reference', { schema: { tags: ['reference'], response: { 200: schemas.ReferenceData } }, preHandler: auth }, async (req, reply) => {
    const ref = await loadReference(ctx.pool);
    reply.header('etag', ref.etag).header('cache-control', 'private, max-age=300');
    if (req.headers['if-none-match'] === ref.etag) return (reply as unknown as FastifyReply).code(304).send();
    return {
      situation_types: ref.situations,
      object_types: ref.types,
      object_statuses: ref.statuses,
      config: { max_area_km2: ctx.env.MAX_AREA_KM2, light_horizon_hours: ctx.env.LIGHT_HORIZON_HOURS, max_drawn_corners: MAX_DRAWN_CORNERS },
    };
  });

  r.get('/objects', { schema: { tags: ['objects'], response: { 200: schemas.ObjectList } }, preHandler: auth }, async (req) => {
    const ref = await loadReference(ctx.pool);
    const rows = await loadObjects(ctx, ctx.pool, req.actor!.accountId);
    const states = await many<{ source: string; last_success_at: Date | null }>(ctx.pool, 'select source, last_success_at from source_state');
    const now = ctx.now();
    return {
      items: rows.map((o) => {
        const { relevant: _r, ...s } = toSummary(ref, o, req.actor!.locale);
        return s;
      }),
      generated_at: now.toISOString(),
      sources: ctx.sources
        .filter((s) => s.enabled)
        .map((s) => {
          const last = states.find((x) => x.source === s.key)?.last_success_at ?? null;
          return { source: s.key, last_success_at: iso(last), stale: !last || now.getTime() - last.getTime() > ctx.env.STALE_INGEST_MINUTES * 60_000 };
        }),
    };
  });

  r.post('/objects', { schema: { tags: ['objects'], body: schemas.ObjectCreate, response: { 201: z.object({ id: schemas.Id }) } }, preHandler: auth },
    async (req, reply) => reply.code(201).send({ id: await createObject(ctx, req.actor!, req.body) }));

  r.get('/objects/:id', { schema: { tags: ['objects'], params: IdParams, response: { 200: schemas.ObjectDetail } }, preHandler: auth }, async (req) => {
    const ref = await loadReference(ctx.pool);
    const o = await getObjectRow(ctx, ctx.pool, req.actor!, req.params.id);
    const { relevant, ...s } = toSummary(ref, o, req.actor!.locale);
    return {
      ...s,
      situations: o.situations,
      alerts: relevant.map((a) => ({
        id: a.id, source: a.source, msg_type: a.msg_type, event_key: a.event_key, situation_key: a.situation_key, level: a.level, source_level: a.source_level,
        onset: iso(a.onset), expires: iso(a.expires)!, title: (req.actor!.locale === 'en' ? a.title_en : a.title_nb) ?? a.title_nb ?? a.title_en, superseded: false,
      })),
      ...objectCanFlags(req.actor!),
    };
  });

  r.patch('/objects/:id', { schema: { tags: ['objects'], params: IdParams, body: schemas.ObjectPatch }, preHandler: auth }, async (req, reply) => {
    await updateObject(ctx, req.actor!, req.params.id, req.body);
    return reply.code(204).send();
  });

  r.delete('/objects/:id', { schema: { tags: ['objects'], params: IdParams }, preHandler: auth }, async (req, reply) => {
    await deleteObject(ctx, req.actor!, req.params.id);
    return reply.code(204).send();
  });

  r.put('/objects/:id/situations', { schema: { tags: ['objects'], params: IdParams, body: schemas.SituationsPut }, preHandler: auth }, async (req, reply) => {
    await setSituations(ctx, req.actor!, req.params.id, req.body.situations);
    return reply.code(204).send();
  });

  r.put('/objects/:id/status', { schema: { tags: ['objects'], params: IdParams, body: schemas.StatusPut }, preHandler: auth }, async (req, reply) => {
    await setStatus(ctx, req.actor!, req.params.id, req.body.status_key, req.body.until);
    return reply.code(204).send();
  });

  r.post('/objects/:id/status/extend', { schema: { tags: ['objects'], params: IdParams, body: schemas.StatusExtend }, preHandler: auth }, async (req, reply) => {
    await extendStatus(ctx, req.actor!, req.params.id, req.body.until);
    return reply.code(204).send();
  });

  r.put('/objects/:id/normal-status', { schema: { tags: ['objects'], params: IdParams, body: schemas.NormalStatusPut }, preHandler: auth }, async (req, reply) => {
    await setNormalStatus(ctx, req.actor!, req.params.id, req.body.status_key);
    return reply.code(204).send();
  });

  // M6: next-day forecast card. The route exists so clients can feature-detect it.
  r.get('/objects/:id/forecast', { schema: { tags: ['objects'], params: IdParams }, preHandler: auth }, async (req) => {
    await getObjectRow(ctx, ctx.pool, req.actor!, req.params.id);
    throw new AppError(501, 'not_available_until_m6', 'the forecast card is part of milestone M6');
  });

  r.get('/geo/search', { schema: { tags: ['geo'], querystring: schemas.GeoSearchQuery, response: { 200: schemas.GeoSearchResponse } }, preHandler: auth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
  async (req) => {
    try {
      return { items: await ctx.providers.geocoder.search(req.query.q) };
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'geocoder search failed');
      throw new AppError(502, 'geocoder_unavailable');
    }
  });

  r.get('/geo/reverse', { schema: { tags: ['geo'], querystring: schemas.GeoReverseQuery, response: { 200: schemas.GeoReverseResponse } }, preHandler: auth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
  async (req) => {
    try {
      return await ctx.providers.geocoder.reverse(req.query.lat, req.query.lon);
    } catch {
      throw new AppError(502, 'geocoder_unavailable');
    }
  });
}
