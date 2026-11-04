import { loadEnv } from '../env';
import { createPool } from './client';
import { migrate } from './migrate';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL, 1);
migrate(pool, (m) => process.stdout.write(`${m}\n`))
  .then((applied) => process.stdout.write(`migrations done (${applied.length} applied)\n`))
  .catch((err) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
