import { schemas } from '@varsling/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { getAlert, listAlerts, listNotifications } from '../../domain/alerts-read';
import { acknowledge } from '../../domain/dispatch';
import { notFound } from '../../lib/errors';
import { requireUser } from '../auth';

const IdParams = z.object({ id: schemas.Id });

export async function alertRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = requireUser(ctx);

  r.get('/alerts', { schema: { tags: ['alerts'], querystring: schemas.AlertListQuery, response: { 200: schemas.AlertList } }, preHandler: auth },
    async (req) => listAlerts(ctx, req.actor!, req.query));

  r.get('/alerts/:id', { schema: { tags: ['alerts'], params: IdParams, response: { 200: schemas.AlertDetail } }, preHandler: auth },
    async (req) => getAlert(ctx, req.actor!, req.params.id));

  r.get('/notifications', { schema: { tags: ['alerts'], querystring: schemas.CursorQuery, response: { 200: schemas.NotificationList } }, preHandler: auth },
    async (req) => listNotifications(ctx, req.actor!, req.query));

  r.post('/notifications/:id/ack', { schema: { tags: ['alerts'], params: IdParams, response: { 200: schemas.AckResponse } }, preHandler: auth }, async (req) => {
    const at = await acknowledge(ctx, req.actor!.id, req.params.id);
    if (!at) throw notFound('notification');
    return { acked_at: at.toISOString() };
  });
}
