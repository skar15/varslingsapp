import { createContext, DeferredQueue } from './bootstrap';
import type { Ctx } from './context';
import { createHandlers } from './jobs/handlers';
import { PgBossQueue } from './jobs/queue';

export async function startWorker(ctx: Ctx, boss: PgBossQueue) {
  await boss.work(createHandlers(ctx), ctx.log);
  // Polling cadence is enforced per source in pollSource (interval and Expires); the tick only wakes it.
  await boss.boss.schedule('ingest.tick', '* * * * *', {}, { singletonKey: 'ingest' });
  await boss.boss.schedule('push.receipts', '*/5 * * * *', {});
  await boss.boss.schedule('ingest.staleness', '*/5 * * * *', {});
  await boss.boss.schedule('maintenance.retention', '17 3 * * *', {}, { tz: 'Europe/Oslo' });
  await boss.boss.schedule('maintenance.erasure', '37 3 * * *', {}, { tz: 'Europe/Oslo' });
  for (const s of ctx.sources) if (!s.enabled) ctx.log.error({ source: s.key, reason: s.disabledReason }, 'alert source disabled');
  ctx.log.info('worker started');
}

/** pg-boss worker entrypoint: pollers, pipeline, dispatch, reminders, status expiry, maintenance. */
async function main() {
  const queue = new DeferredQueue();
  const ctx = createContext(queue);
  const boss = await PgBossQueue.start(ctx.env.DATABASE_URL, ctx.log);
  queue.target = boss;
  await startWorker(ctx, boss);
  const shutdown = async () => {
    await boss.stop();
    await ctx.pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && /worker\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
