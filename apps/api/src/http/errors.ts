import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors';

const PROBLEM = 'application/problem+json';

/** Errors use problem+json (RFC 9457). */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).type(PROBLEM).send({
        type: 'about:blank', title: 'Bad Request', status: 400, code: 'validation_error', detail: 'request does not match the schema',
        errors: err.validation.map((v) => ({ path: (v.instancePath || ((v.params as { issue?: { path?: unknown[] } })?.issue?.path ?? []).join('/')).toString(), message: v.message ?? 'invalid' })),
      });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ issues: err.cause.issues, url: req.url }, 'response serialization error');
      return reply.code(500).type(PROBLEM).send({ type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'serialization_error' });
    }
    if (err instanceof AppError) {
      return reply.code(err.status).type(PROBLEM).send({ type: 'about:blank', title: err.message, status: err.status, code: err.code, ...(err.extra ?? {}) });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).type(PROBLEM).send({ type: 'about:blank', title: err.message, status: err.statusCode, code: err.code ?? 'error' });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).type(PROBLEM).send({ type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'internal' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).type(PROBLEM).send({ type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' }));
}
