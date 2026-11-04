import { createContext, DeferredQueue } from './bootstrap';
import { buildApp } from './http/app';
import { PgBossQueue } from './jobs/queue';

/** HTTP entrypoint. Sends jobs through pg-boss but does not work them (that is worker.ts). */
async function main() {
  const queue = new DeferredQueue();
  const ctx = createContext(queue);
  const boss = await PgBossQueue.start(ctx.env.DATABASE_URL, ctx.log);
  queue.target = boss;
  const app = await buildApp(ctx);
  await app.listen({ port: ctx.env.PORT, host: '0.0.0.0' });
  const shutdown = async () => {
    await app.close();
    await boss.stop();
    await ctx.pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
