import { loadEnv } from '../env';
import { createPool } from './client';
import { waitForDatabase } from './connect-check';
import { seed } from './seed';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL, 1);
waitForDatabase(pool, env.DATABASE_URL)
  .then(() => seed(pool))
  .then(() => process.stdout.write('seed done\n'))
  .catch((err) => {
    process.stderr.write(`\nSeed failed: ${(err as Error).message}\n\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
