import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../src/db/migrate';
import { seed } from '../../src/db/seed';

/**
 * Spatial code is tested against a real PostGIS (rule 4). Uses TEST_DATABASE_URL when set
 * (CI service container or a local cluster); otherwise starts PostGIS with Testcontainers.
 */
export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<unknown>) | undefined;
  if (!url) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
    url = container.getConnectionUri();
    stop = () => container.stop();
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  // Migration on an empty database is part of every milestone's definition of done.
  await pool.query('drop schema if exists public cascade; drop schema if exists pgboss cascade; create schema public;');
  await migrate(pool);
  await seed(pool);
  await pool.end();
  project.provide('databaseUrl', url);
  return async () => {
    await stop?.();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
