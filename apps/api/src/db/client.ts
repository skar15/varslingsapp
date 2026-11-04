import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// Return bigint/numeric as numbers where safe; timestamps stay Date.
pg.types.setTypeParser(20, (v) => Number(v));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Anything that can run a query: the pool or a client inside a transaction. */
export type Db = Pick<pg.Pool, 'query'> | pg.PoolClient;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDrizzle(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export async function withTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T extends pg.QueryResultRow>(db: Db, text: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await db.query<T>(text, params);
  return r.rows[0];
}

export async function many<T extends pg.QueryResultRow>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query<T>(text, params);
  return r.rows;
}
