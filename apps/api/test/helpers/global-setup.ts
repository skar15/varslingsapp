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
    let container;
    try {
      container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
    } catch (err) {
      throw new Error(
        'The API tests need PostGIS. Either start Docker (Docker Desktop, OrbStack or Colima) so Testcontainers can run it, ' +
          'or run `docker compose up -d db` and set TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/varsling_test ' +
          `(never your development database: the tests wipe it). Cause: ${(err as Error).message}`,
      );
    }
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
