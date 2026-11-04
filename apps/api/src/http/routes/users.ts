import { schemas } from '@varsling/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { invite, listUsers, removeUser, revokeInvitation, setRights } from '../../domain/users';
import { requireUser } from '../auth';

const IdParams = z.object({ id: schemas.Id });

export async function userRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = requireUser(ctx);

  r.get('/users', { schema: { tags: ['users'], response: { 200: schemas.UserList } }, preHandler: auth }, async (req) => listUsers(ctx, req.actor!));

  r.post('/users/invitations', {
    schema: { tags: ['users'], body: schemas.InvitationCreate, response: { 201: schemas.InvitationCreated } }, preHandler: auth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => reply.code(201).send(await invite(ctx, req.actor!, req.body)));

  r.delete('/users/invitations/:id', { schema: { tags: ['users'], params: IdParams }, preHandler: auth }, async (req, reply) => {
    await revokeInvitation(ctx, req.actor!, req.params.id);
    return reply.code(204).send();
  });

  r.delete('/users/:id', { schema: { tags: ['users'], params: IdParams }, preHandler: auth }, async (req, reply) => {
    await removeUser(ctx, req.actor!, req.params.id);
    return reply.code(204).send();
  });

  r.patch('/users/:id/rights', { schema: { tags: ['users'], params: IdParams, body: schemas.RightsPatch }, preHandler: auth }, async (req, reply) => {
    await setRights(ctx, req.actor!, req.params.id, req.body.can_manage_objects);
    return reply.code(204).send();
  });
}
