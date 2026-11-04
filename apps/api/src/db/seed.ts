import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));

async function configDir(): Promise<string> {
  if (process.env.CONFIG_DIR) return process.env.CONFIG_DIR;
  for (const c of [path.join(here, '../../../../config'), path.join(here, '../../../config'), path.join(process.cwd(), 'config'), path.join(process.cwd(), '../../config')]) {
    try {
      await readFile(path.join(c, 'situation_types.json'));
      return c;
    } catch {
      /* next */
    }
  }
  throw new Error('config directory not found; set CONFIG_DIR');
}

async function load<T>(dir: string, file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(dir, file), 'utf8')) as T;
}

interface I18n { nb: string; en?: string }

/**
 * Loads reference data from config/ (working rule 6). Idempotent upserts, so it is
 * safe to run on every deploy. Rows removed from config are left in place, because
 * existing objects may reference them; set available=false instead.
 */
export async function seed(pool: pg.Pool, env: Record<string, string | undefined> = process.env): Promise<void> {
  const dir = await configDir();
  const situations = await load<{ key: string; sort: number; available: boolean; i18n: I18n }[]>(dir, 'situation_types.json');
  const types = await load<{ key: string; sort: number; category: string; icon: string; i18n: I18n; defaults: string[] }[]>(dir, 'object_types.json');
  const statuses = await load<{ key: string; sort: number; i18n: I18n; adds: string[]; removes: string[]; applies_to: string[] | null }[]>(dir, 'object_statuses.json');
  const events = await load<{ rows: { source: string; event: string; situation: string }[] }>(dir, 'event_map.json');
  const levels = await load<{ rows: { source: string; source_level: string; level: string | null }[] }>(dir, 'level_map.json');
  const plans = await load<{ rows: { key: string; sort: number; i18n: I18n; max_users: number; max_objects: number; sms_monthly_cap: number }[] }>(dir, 'plans.json');
  const advice = await load<{ rows: { key: string; situation: string; status: string | null; category: string | null; i18n: I18n }[] }>(dir, 'advice.json');
  const thresholds = await load<{ rows: { situation: string; parameter: string; green: number | null; yellow: number | null; red: number | null }[] }>(dir, 'thresholds.json');

  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const s of situations) {
      await client.query(
        `insert into situation_types(key,i18n,available,sort) values ($1,$2,$3,$4)
         on conflict (key) do update set i18n=excluded.i18n, available=excluded.available, sort=excluded.sort, updated_at=now()`,
        [s.key, s.i18n, s.available, s.sort],
      );
    }
    for (const t of types) {
      await client.query(
        `insert into object_types(key,i18n,defaults,category,icon,sort) values ($1,$2,$3,$4,$5,$6)
         on conflict (key) do update set i18n=excluded.i18n, defaults=excluded.defaults, category=excluded.category,
           icon=excluded.icon, sort=excluded.sort, updated_at=now()`,
        [t.key, t.i18n, t.defaults, t.category, t.icon, t.sort],
      );
    }
    for (const s of statuses) {
      await client.query(
        `insert into object_statuses(key,i18n,adds,removes,applies_to,sort) values ($1,$2,$3,$4,$5,$6)
         on conflict (key) do update set i18n=excluded.i18n, adds=excluded.adds, removes=excluded.removes,
           applies_to=excluded.applies_to, sort=excluded.sort, updated_at=now()`,
        [s.key, s.i18n, s.adds, s.removes, s.applies_to, s.sort],
      );
    }
    await client.query('delete from event_map');
    for (const e of events.rows) {
      await client.query('insert into event_map(source,event,situation_key) values ($1,$2,$3)', [e.source, e.event, e.situation]);
    }
    await client.query('delete from level_map');
    for (const l of levels.rows) {
      await client.query('insert into level_map(source,source_level,level) values ($1,$2,$3)', [l.source, l.source_level, l.level]);
    }
    for (const p of plans.rows) {
      const priceId = env[`STRIPE_PRICE_ID_${p.key.toUpperCase()}`] ?? null;
      await client.query(
        `insert into plans(key,name,i18n,max_users,max_objects,sms_monthly_cap,stripe_price_id,sort) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (key) do update set name=excluded.name, i18n=excluded.i18n, max_users=excluded.max_users,
           max_objects=excluded.max_objects, sms_monthly_cap=excluded.sms_monthly_cap,
           stripe_price_id=coalesce(excluded.stripe_price_id, plans.stripe_price_id), sort=excluded.sort, updated_at=now()`,
        [p.key, p.i18n.nb, p.i18n, p.max_users, p.max_objects, p.sms_monthly_cap, priceId, p.sort],
      );
    }
    await client.query('delete from advice');
    for (const a of advice.rows) {
      await client.query('insert into advice(key,situation_key,status_key,category,i18n) values ($1,$2,$3,$4,$5)', [a.key, a.situation, a.status, a.category, a.i18n]);
    }
    await client.query('delete from thresholds');
    for (const t of thresholds.rows) {
      await client.query('insert into thresholds(situation_key,parameter,green,yellow,red) values ($1,$2,$3,$4,$5)', [t.situation, t.parameter, t.green, t.yellow, t.red]);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
