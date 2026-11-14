import type pg from 'pg';

/** Readable target without the password, e.g. "localhost:5433/varsling". */
export function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(invalid DATABASE_URL)';
  }
}

function explain(err: unknown, target: string): string {
  const e = err as { code?: string; message?: string; errors?: { code?: string; message?: string }[] };
  const code = e.code ?? e.errors?.[0]?.code;
  const msg = e.message || e.errors?.map((x) => x.message).join('; ') || String(err);
  switch (code) {
    case 'ECONNREFUSED':
      return `Nothing is listening on ${target}. Start the database with \`docker compose up -d db\` and check that DB_PORT in .env matches the port in DATABASE_URL.`;
    case '28P01':
      return `Wrong password for ${target}. That port is probably another PostgreSQL on your machine, not the project's container: set DB_PORT=5433 in .env and use port 5433 in DATABASE_URL.`;
    case '3D000':
      return `The database in ${target} does not exist. If it is the project's container, recreate it with \`docker compose down -v && docker compose up -d db\`.`;
    case '57P03':
      return `The database at ${target} is still starting up. Wait a few seconds and try again.`;
    default:
      return `Could not use the database at ${target}: ${code ? `[${code}] ` : ''}${msg}`;
  }
}

/** Waits up to `seconds` for the database (a fresh or emulated container needs time), then explains failures. */
export async function waitForDatabase(pool: pg.Pool, url: string, seconds = 60): Promise<void> {
  const target = describeTarget(url);
  const deadline = Date.now() + seconds * 1000;
  let lastErr: unknown;
  let announced = false;
  while (Date.now() < deadline) {
    try {
      await pool.query('select 1');
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string }).code ?? (err as { errors?: { code?: string }[] }).errors?.[0]?.code;
      if (code !== 'ECONNREFUSED' && code !== '57P03' && code !== 'ECONNRESET') break;
      if (!announced) {
        process.stdout.write(`waiting for the database at ${target} …\n`);
        announced = true;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(explain(lastErr, target));
}

export function explainPostgisMissing(err: unknown, url: string): Error {
  const msg = (err as Error).message ?? '';
  if (/extension "postgis"/.test(msg) || /postgis.*not available/i.test(msg)) {
    return new Error(`The PostgreSQL at ${describeTarget(url)} has no PostGIS. It is probably a local install, not the project's container: set DB_PORT=5433 in .env and use port 5433 in DATABASE_URL.`);
  }
  return err as Error;
}
