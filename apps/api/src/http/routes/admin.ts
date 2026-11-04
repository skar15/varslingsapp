import { timingSafeEqual } from 'node:crypto';
import { schemas } from '@varsling/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Ctx } from '../../context';
import { simulateAlert } from '../../domain/simulate';
import { unauthorized } from '../../lib/errors';

/** Registered only outside production (security rule; a test proves it). */
export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  const key = ctx.env.ADMIN_API_KEY;
  if (ctx.env.APP_ENV === 'production' || !key) return;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const check = async (req: FastifyRequest) => {
    const given = Buffer.from(String(req.headers['x-admin-key'] ?? ''));
    const expected = Buffer.from(key);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized('invalid_admin_key');
  };
  r.post('/admin/simulate-alert', { schema: { tags: ['admin'], body: schemas.SimulateAlert, response: { 201: schemas.SimulateAlertResponse } }, preHandler: check },
    async (req, reply) => reply.code(201).send(await simulateAlert(ctx, req.body)));
}
