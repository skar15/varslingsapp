import { PgBoss } from 'pg-boss';
import type { Logger } from '../lib/logger';
import { JOB_NAMES, type JobData, type JobHandlers, type JobName, type JobQueue, type SendOpts } from './types';

export const RETRY_LIMIT = 5;

/** pg-boss on the same Postgres: retries, schedules and dead-letter queue without Redis. */
export class PgBossQueue implements JobQueue {
  constructor(readonly boss: PgBoss) {}

  static async start(connectionString: string, log: Logger): Promise<PgBossQueue> {
    const boss = new PgBoss({ connectionString, schema: 'pgboss' });
    boss.on('error', (err: unknown) => log.error({ err }, 'pg-boss error'));
    await boss.start();
    await boss.createQueue('dead-letter').catch(() => undefined);
    for (const name of JOB_NAMES) {
      await boss
        .createQueue(name, { retryLimit: RETRY_LIMIT, retryBackoff: true, retryDelay: 5, deadLetter: 'dead-letter', expireInSeconds: 300 })
        .catch(() => undefined);
    }
    return new PgBossQueue(boss);
  }

  async send<K extends JobName>(name: K, data: JobData[K], opts: SendOpts = {}): Promise<void> {
    await this.boss.send(name, data as object, {
      ...(opts.startAfter ? { startAfter: opts.startAfter } : {}),
      ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
    });
  }

  async work(handlers: JobHandlers, log: Logger): Promise<void> {
    for (const name of JOB_NAMES) {
      const handler = handlers[name] as (data: unknown, meta: { retryCount: number; retryLimit: number }) => Promise<void>;
      await this.boss.work(name, { localConcurrency: name === 'notify.dispatch' ? 4 : 1 }, async (jobs: { id: string; data: unknown; retryCount: number }[]) => {
        for (const job of jobs) {
          try {
            await handler(job.data, { retryCount: job.retryCount, retryLimit: RETRY_LIMIT });
          } catch (err) {
            log.warn({ job: name, jobId: job.id, retryCount: job.retryCount, err: (err as Error).message }, 'job failed');
            throw err;
          }
        }
      });
    }
  }

  async stop() {
    await this.boss.stop({ graceful: true, timeout: 20_000 });
  }
}

/** In-memory queue for tests: records jobs and runs them on demand. */
export class FakeQueue implements JobQueue {
  jobs: { name: JobName; data: unknown; startAfter?: Date; singletonKey?: string }[] = [];
  history: { name: JobName; data: unknown; startAfter?: Date }[] = [];

  async send<K extends JobName>(name: K, data: JobData[K], opts: SendOpts = {}): Promise<void> {
    if (opts.singletonKey && this.jobs.some((j) => j.name === name && j.singletonKey === opts.singletonKey)) return;
    this.jobs.push({ name, data, startAfter: opts.startAfter, singletonKey: opts.singletonKey });
    this.history.push({ name, data, startAfter: opts.startAfter });
  }

  pending(name?: JobName) {
    return this.jobs.filter((j) => !name || j.name === name);
  }

  /**
   * Runs queued jobs whose startAfter is not after `until` (default: only immediate jobs),
   * including jobs they enqueue, until none are eligible. Returns the number of jobs run.
   */
  async drain(handlers: Partial<JobHandlers>, opts: { until?: Date; only?: JobName[] } = {}): Promise<number> {
    let ran = 0;
    for (;;) {
      const idx = this.jobs.findIndex(
        (j) => (!opts.only || opts.only.includes(j.name)) && (!j.startAfter || (opts.until !== undefined && j.startAfter <= opts.until)),
      );
      if (idx < 0) return ran;
      const [job] = this.jobs.splice(idx, 1);
      const h = handlers[job!.name] as ((d: unknown, m: { retryCount: number; retryLimit: number }) => Promise<void>) | undefined;
      if (h) await h(job!.data, { retryCount: 0, retryLimit: 1 });
      ran++;
      if (ran > 10_000) throw new Error('drain runaway');
    }
  }
}
