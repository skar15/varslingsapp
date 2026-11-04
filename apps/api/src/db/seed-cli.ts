import { loadEnv } from '../env';
import { createPool } from './client';
import { seed } from './seed';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL, 1);
seed(pool)
  .then(() => process.stdout.write('seed done\n'))
  .catch((err) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
