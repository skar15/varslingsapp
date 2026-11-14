import { loadEnv } from '../env';
import { createPool } from './client';
import { explainPostgisMissing, waitForDatabase } from './connect-check';
import { migrate } from './migrate';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL, 1);
waitForDatabase(pool, env.DATABASE_URL)
  .then(() => migrate(pool, (m) => process.stdout.write(`${m}\n`)).catch((err) => Promise.reject(explainPostgisMissing(err, env.DATABASE_URL))))
  .then((applied) => process.stdout.write(`migrations done (${applied.length} applied)\n`))
  .catch((err) => {
    process.stderr.write(`\nMigration failed: ${(err as Error).message}\n\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
