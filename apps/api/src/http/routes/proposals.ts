import { schemas } from '@varsling/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { approveProposal, createProposal, listProposals, rejectProposal } from '../../domain/proposals';
import { requireUser } from '../auth';

const IdParams = z.object({ id: schemas.Id });

export async function proposalRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = requireUser(ctx);

  r.get('/proposals', { schema: { tags: ['proposals'], response: { 200: schemas.ProposalList } }, preHandler: auth }, async (req) => ({ items: await listProposals(ctx, req.actor!) }));

  r.post('/proposals', { schema: { tags: ['proposals'], body: schemas.ProposalCreate, response: { 201: z.object({ id: schemas.Id }) } }, preHandler: auth },
    async (req, reply) => reply.code(201).send({ id: await createProposal(ctx, req.actor!, req.body) }));

  r.post('/proposals/:id/approve', { schema: { tags: ['proposals'], params: IdParams, body: schemas.ProposalDecision.nullish() }, preHandler: auth }, async (req, reply) => {
    await approveProposal(ctx, req.actor!, req.params.id, req.body?.note);
    return reply.code(204).send();
  });

  r.post('/proposals/:id/reject', { schema: { tags: ['proposals'], params: IdParams, body: schemas.ProposalDecision.nullish() }, preHandler: auth }, async (req, reply) => {
    await rejectProposal(ctx, req.actor!, req.params.id, req.body?.note);
    return reply.code(204).send();
  });
}
