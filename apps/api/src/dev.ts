import { createContext, DeferredQueue } from './bootstrap';
import { migrate } from './db/migrate';
import { seed } from './db/seed';
import { buildApp } from './http/app';
import { PgBossQueue } from './jobs/queue';
import { startWorker } from './worker';

/** `pnpm dev`: migrates, seeds, and runs the API and worker in one process. */
async function main() {
  const queue = new DeferredQueue();
  const ctx = createContext(queue);
  await migrate(ctx.pool, (m) => ctx.log.info(m));
  await seed(ctx.pool);
  const boss = await PgBossQueue.start(ctx.env.DATABASE_URL, ctx.log);
  queue.target = boss;
  await startWorker(ctx, boss);
  const app = await buildApp(ctx);
  await app.listen({ port: ctx.env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
