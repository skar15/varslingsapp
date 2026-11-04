import * as Sentry from '@sentry/node';
import type { Ctx } from './context';
import { createPool } from './db/client';
import { loadEnv, type Env } from './env';
import type { JobQueue } from './jobs/types';
import { createLogger } from './lib/logger';
import { createProviders } from './providers';
import { createSources } from './sources';

export function initSentry(env: Env) {
  if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.APP_ENV, tracesSampleRate: 0.05 });
}

export function createContext(jobs: JobQueue, envIn?: Env): Ctx {
  const env = envIn ?? loadEnv();
  const log = createLogger(env.LOG_LEVEL);
  initSentry(env);
  return {
    env,
    log,
    pool: createPool(env.DATABASE_URL),
    providers: createProviders(env, log),
    sources: createSources(env),
    jobs,
    now: () => new Date(),
    opsAlert: (message, extra) => {
      log.error({ ops: true, ...extra }, message);
      if (env.SENTRY_DSN) Sentry.captureMessage(message, { level: 'error', extra });
    },
  };
}

/** A queue that only allows sending; replaced by pg-boss once it has started. */
export class DeferredQueue implements JobQueue {
  target?: JobQueue;
  async send(...args: Parameters<JobQueue['send']>) {
    if (!this.target) throw new Error('job queue not started');
    return this.target.send(...args);
  }
}
