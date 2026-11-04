import { schemas } from '@varsling/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { completeClaim, createCheckout, getClaim, handleBillingEvent, listPlans } from '../../domain/billing';
import { ingestHealth } from '../../domain/ingest';
import { smsDeliveryReport } from '../../domain/dispatch';
import { acceptInvitation } from '../../domain/users';
import { badRequest, unauthorized } from '../../lib/errors';
import { requireIdentity } from '../auth';

const TokenParams = z.object({ token: z.string().min(20).max(100) });

export async function publicRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/health', { schema: { tags: ['health'], response: { 200: schemas.Health } } }, async () => ({
    ok: true, version: process.env.APP_VERSION ?? 'dev', time: ctx.now().toISOString(),
  }));

  r.get('/health/ingest', { schema: { tags: ['health'], response: { 200: schemas.IngestHealth, 503: schemas.IngestHealth } } }, async (_req, reply) => {
    const sources = await ingestHealth(ctx);
    const ok = sources.filter((s) => s.enabled).every((s) => !s.stale);
    const body = { ok, sources: sources.map(({ enabled: _e, ...s }) => s) };
    return reply.code(ok ? 200 : 503).send(body);
  });

  r.get('/plans', { schema: { tags: ['billing'], response: { 200: schemas.PlanList } } }, async () => ({ items: await listPlans(ctx) }));

  r.post('/billing/checkout-session', { schema: { tags: ['billing'], body: schemas.CheckoutSessionRequest, response: { 200: schemas.CheckoutSessionResponse } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => createCheckout(ctx, req.body.plan_key, req.body.locale ?? 'nb'));

  r.get('/claim/:token', { schema: { tags: ['registration'], params: TokenParams, response: { 200: schemas.ClaimInfo } }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => getClaim(ctx, req.params.token));

  r.post('/claim/:token/complete', {
    schema: { tags: ['registration'], params: TokenParams, body: schemas.ClaimComplete, response: { 200: z.object({ account_id: schemas.Id }) } },
    preHandler: requireIdentity(ctx),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => ({ account_id: await completeClaim(ctx, req.identity!, req.params.token, req.body) }));

  r.post('/invitations/:token/accept', {
    schema: { tags: ['users'], params: TokenParams, body: schemas.InvitationAccept, response: { 200: z.object({ account_id: schemas.Id }) } },
    preHandler: requireIdentity(ctx),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => ({ account_id: await acceptInvitation(ctx, req.identity!, req.params.token, req.body) }));

  // Webhooks need the raw body (signatures), so they live in their own encapsulated scope.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(body as string))),
    );

    scope.post('/webhooks/stripe', { schema: { tags: ['webhooks'], hide: true } }, async (req, reply) => {
      let event;
      try {
        event = ctx.providers.payment.parseWebhook(req.body as Buffer, req.headers['stripe-signature'] as string | undefined);
      } catch {
        throw badRequest('invalid_signature');
      }
      const result = await handleBillingEvent(ctx, event);
      return reply.send({ received: true, result });
    });

    scope.post('/webhooks/sms', { schema: { tags: ['webhooks'], hide: true } }, async (req, reply) => {
      const url = `${ctx.env.API_PUBLIC_URL}/v1/webhooks/sms`;
      const report = ctx.providers.sms.parseDeliveryReport(url, req.body as Record<string, string>, req.headers['x-twilio-signature'] as string | undefined);
      if (!report) throw unauthorized('invalid_signature');
      await smsDeliveryReport(ctx, report);
      return reply.code(204).send();
    });
  });
}
