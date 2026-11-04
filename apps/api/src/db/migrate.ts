import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Locates the SQL migrations both from source (src/db) and from the bundled dist/. */
async function migrationsDir(): Promise<string> {
  for (const candidate of [path.join(here, 'migrations'), path.join(here, 'db', 'migrations'), path.join(here, '..', 'src', 'db', 'migrations')]) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error('migrations directory not found');
}

/**
 * Applies pending SQL migrations in file-name order, each in its own transaction.
 * Migrations must stay backward compatible so a rollback of the app is safe.
 */
export async function migrate(pool: pg.Pool, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const dir = await migrationsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock(727274)');
    await client.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query<{ version: string }>('select version from schema_migrations')).rows.map((r) => r.version));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(version) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
        log(`applied ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => undefined);
    client.release();
  }
  return applied;
}
