import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Ctx } from '../context';
import { registerErrorHandler } from './errors';
import { adminRoutes } from './routes/admin';
import { alertRoutes } from './routes/alerts';
import { meRoutes } from './routes/me';
import { objectRoutes } from './routes/objects';
import { proposalRoutes } from './routes/proposals';
import { publicRoutes } from './routes/public';
import { userRoutes } from './routes/users';

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: opts.logger === false ? undefined : (ctx.log as unknown as FastifyBaseLogger),
    trustProxy: true,
    bodyLimit: 512 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(cors, { origin: ctx.env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: false });
  // Per user (bearer token) and per IP.
  await app.register(rateLimit, {
    max: ctx.env.APP_ENV === 'test' ? 10_000 : 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      return auth ? `u:${createHash('sha1').update(auth).digest('hex')}` : `ip:${req.ip}`;
    },
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Varslingsapp API', version: '1.0.0', description: 'REST API for the Varslingsapp web and mobile clients.' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(
    async (v1) => {
      await publicRoutes(v1, ctx);
      await meRoutes(v1, ctx);
      await userRoutes(v1, ctx);
      await objectRoutes(v1, ctx);
      await alertRoutes(v1, ctx);
      await proposalRoutes(v1, ctx);
      await adminRoutes(v1, ctx);
      v1.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
    },
    { prefix: '/v1' },
  );
  return app as unknown as FastifyInstance;
}
