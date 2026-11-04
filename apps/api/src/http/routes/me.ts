import { schemas } from '@varsling/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { changePlan, portalSession, requestDeletion } from '../../domain/billing';
import { deliverInfo } from '../../domain/info';
import { accountDto, me, patchMe, refreshPhone, registerDevice, removeDevice } from '../../domain/users';
import { requireUser } from '../auth';

export async function meRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = requireUser(ctx);

  r.get('/me', { schema: { tags: ['me'], response: { 200: schemas.MeSchema } }, preHandler: auth }, async (req) => me(ctx, req.actor!));

  r.patch('/me', { schema: { tags: ['me'], body: schemas.MePatch, response: { 200: schemas.MeSchema } }, preHandler: auth }, async (req) => {
    await patchMe(ctx, req.actor!, req.body);
    return me(ctx, req.actor!);
  });

  r.post('/me/phone/refresh', {
    schema: { tags: ['me'], response: { 200: z.object({ phone_e164: z.string().nullable(), phone_verified: z.boolean() }) } }, preHandler: auth,
  }, async (req) => refreshPhone(ctx, req.actor!));

  r.post('/me/devices', { schema: { tags: ['me'], body: schemas.DeviceRegister, response: { 200: schemas.DeviceRegistered } }, preHandler: auth },
    async (req) => ({ id: await registerDevice(ctx, req.actor!, req.body) }));

  r.delete('/me/devices/:id', { schema: { tags: ['me'], params: z.object({ id: schemas.Id }) }, preHandler: auth }, async (req, reply) => {
    await removeDevice(ctx, req.actor!, req.params.id);
    return reply.code(204).send();
  });

  r.post('/me/test-notification', { schema: { tags: ['me'] }, preHandler: auth, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req, reply) => {
    await deliverInfo(ctx, { userIds: [req.actor!.id], bodyKey: 'msg.test', data: { kind: 'test' } });
    return reply.code(204).send();
  });

  r.get('/account', { schema: { tags: ['account'], response: { 200: schemas.AccountSchema } }, preHandler: auth }, async (req) => accountDto(ctx, ctx.pool, req.actor!.accountId));

  r.post('/billing/portal-session', { schema: { tags: ['billing'], response: { 200: schemas.PortalSessionResponse } }, preHandler: auth }, async (req) => portalSession(ctx, req.actor!));

  r.post('/billing/change-plan', { schema: { tags: ['billing'], body: z.object({ plan_key: z.string() }) }, preHandler: auth }, async (req, reply) => {
    await changePlan(ctx, req.actor!, req.body.plan_key);
    return reply.code(202).send();
  });

  r.post('/account/deletion-request', { schema: { tags: ['account'], body: z.object({ confirm: z.literal(true) }) }, preHandler: auth }, async (req, reply) => {
    await requestDeletion(ctx, req.actor!);
    return reply.code(202).send();
  });
}
