import {
  closeRing, maxLevel, monitoredSet, objectDisplayName, statusesForType, validateObjectGeometry,
  type AlertLevel, type LocationInput, type MonitoredSituation, type ObjectGeometry, type ObjectSummaryDto, type schemas, type Sensitivity,
} from '@varsling/shared';
import type { z } from 'zod';
import type { Ctx } from '../context';
import type { InfoParam } from '../jobs/types';
import { many, one, withTx, type Db } from '../db/client';
import { audit } from '../lib/audit';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { iso } from '../lib/time';
import { getAccount, getPlan } from './accounts';
import { assertCan, can, type Actor } from './permissions';
import { loadReference, statusI18n, typeName, type Reference } from './reference';

type ObjectCreate = z.infer<typeof schemas.ObjectCreate>;
type ObjectPatch = z.infer<typeof schemas.ObjectPatch>;

export interface ObjectRow {
  id: string;
  account_id: string;
  nickname: string | null;
  type_key: string | null;
  normal_status_key: string;
  status_key: string;
  status_until: Date | null;
  status_set_by: string | null;
  status_set_by_name: string | null;
  status_version: number;
  location_kind: 'none' | 'point' | 'area';
  geometry: ObjectGeometry | null;
  place_label: string | null;
  county_no: string | null;
  municipality_no: string | null;
  situations: { situation_key: string; sensitivity: Sensitivity }[];
  active_alerts: ActiveAlertRow[];
}

export interface ActiveAlertRow {
  id: string;
  source: string;
  msg_type: 'alert' | 'update' | 'cancel';
  event_key: string;
  situation_key: string | null;
  level: AlertLevel;
  source_level: string;
  onset: string | null;
  expires: string;
  title_nb: string | null;
  title_en: string | null;
}

const OBJECT_SELECT = `
  select o.id, o.account_id, o.nickname, o.type_key, o.normal_status_key, o.status_key, o.status_until, o.status_set_by,
         su.name as status_set_by_name, o.status_version, o.location_kind,
         st_asgeojson(o.geom::geometry, 6)::json as geometry, o.place_label, o.county_no, o.municipality_no,
         coalesce((select json_agg(json_build_object('situation_key', s.situation_key, 'sensitivity', s.sensitivity) order by s.situation_key)
                   from object_situations s where s.object_id = o.id), '[]'::json) as situations,
         coalesce((select json_agg(json_build_object('id', a.id, 'source', a.source, 'msg_type', a.msg_type, 'event_key', a.event_key,
                     'situation_key', a.situation_key, 'level', a.level, 'source_level', a.source_level, 'onset', a.onset,
                     'expires', a.expires, 'title_nb', a.title_nb, 'title_en', a.title_en) order by a.level desc, a.onset nulls first)
                   from alerts a
                   where o.geom is not null and a.superseded_by is null and a.level is not null
                     and a.expires > $2::timestamptz and (a.onset is null or a.onset <= $2::timestamptz + make_interval(hours => $3::int))
                     and st_intersects(a.geom, o.geom)), '[]'::json) as active_alerts
  from objects o left join users su on su.id = o.status_set_by`;

export async function loadObjects(ctx: Ctx, db: Db, accountId: string, objectId?: string): Promise<ObjectRow[]> {
  return many<ObjectRow>(
    db,
    `${OBJECT_SELECT} where o.account_id = $1 and o.deleted_at is null ${objectId ? 'and o.id = $4' : ''} order by o.created_at, o.id`,
    objectId ? [accountId, ctx.now(), ctx.env.LIGHT_HORIZON_HOURS, objectId] : [accountId, ctx.now(), ctx.env.LIGHT_HORIZON_HOURS],
  );
}

export function monitoredFor(ref: Reference, o: Pick<ObjectRow, 'type_key' | 'status_key' | 'situations'>): Map<string, MonitoredSituation> {
  return monitoredSet({ type_key: o.type_key, status_key: o.status_key, situations: o.situations }, ref);
}

export function alertTitle(a: { title_nb: string | null; title_en: string | null }, locale: 'nb' | 'en'): string | null {
  return (locale === 'en' ? a.title_en : a.title_nb) ?? a.title_nb ?? a.title_en;
}

/**
 * Dashboard light, computed on read: highest level among alerts with onset within the
 * horizon, not expired, not superseded, and a situation in the monitored set. It ignores
 * sensitivity (the light is information; sensitivity is a notification setting).
 */
export function toSummary(ref: Reference, o: ObjectRow, locale: 'nb' | 'en'): ObjectSummaryDto & { relevant: ActiveAlertRow[] } {
  const set = monitoredFor(ref, o);
  const relevant = o.active_alerts.filter((a) => a.situation_key && set.has(a.situation_key));
  const level = maxLevel(relevant.map((a) => a.level));
  const top = relevant
    .filter((a) => a.level === level)
    .sort((a, b) => (a.onset ?? '').localeCompare(b.onset ?? ''))[0];
  return {
    id: o.id,
    nickname: o.nickname,
    display_name: objectDisplayName(o.nickname, typeName(ref, o.type_key, locale), o.place_label, locale === 'en' ? 'Object' : 'Objekt'),
    type_key: o.type_key,
    status_key: o.status_key,
    normal_status_key: o.normal_status_key,
    status_until: iso(o.status_until),
    status_set_by: o.status_set_by ? { id: o.status_set_by, name: o.status_set_by_name ?? '' } : null,
    location_kind: o.location_kind,
    geometry: o.geometry,
    place_label: o.place_label,
    municipality_no: o.municipality_no,
    light: level ?? 'none',
    summary: top
      ? { level: top.level, situation_key: top.situation_key, onset: iso(top.onset), expires: iso(top.expires)!, title: alertTitle(top, locale), alert_id: top.id }
      : null,
    monitored: [...set.values()].map((m) => ({ key: m.key, sensitivity: m.sensitivity, effective_sensitivity: m.effectiveSensitivity, added_by_status: m.addedByStatus })),
    relevant,
  };
}

export async function getObjectRow(ctx: Ctx, db: Db, actor: Actor, id: string): Promise<ObjectRow> {
  const [o] = await loadObjects(ctx, db, actor.accountId, id);
  if (!o) throw notFound('object');
  return o;
}

// ---------------------------------------------------------------- validation

function validateType(ref: Reference, typeKey: string | null | undefined) {
  if (typeKey && !ref.types.some((t) => t.key === typeKey)) throw unprocessable('invalid_type', `unknown object type ${typeKey}`);
}

function validateStatus(ref: Reference, typeKey: string | null, statusKey: string) {
  if (!ref.statuses.some((s) => s.key === statusKey)) throw unprocessable('invalid_status', `unknown status ${statusKey}`);
  if (!statusesForType(ref, typeKey).some((s) => s.key === statusKey)) throw unprocessable('status_not_for_type', `status ${statusKey} does not apply to this object type`);
}

function validateSituations(ref: Reference, typeKey: string | null, situations: { situation_key: string }[] | undefined) {
  for (const s of situations ?? []) {
    const ref_ = ref.situations.find((x) => x.key === s.situation_key);
    if (!ref_ || !ref_.available) throw unprocessable('invalid_situation', `situation ${s.situation_key} is not available`);
  }
  if (new Set((situations ?? []).map((s) => s.situation_key)).size !== (situations ?? []).length) throw unprocessable('duplicate_situation');
  const type = ref.types.find((t) => t.key === typeKey);
  if (type && type.defaults.length === 0 && !(situations ?? []).length) {
    throw unprocessable('situations_required', 'object type "other" requires at least one situation type');
  }
}

interface LocationSql {
  kind: 'none' | 'point' | 'area';
  geojson: string | null;
  placeLabel: string | null;
  lat?: number;
  lon?: number;
}

function prepareLocation(ctx: Ctx, loc: LocationInput): LocationSql {
  if (loc.kind === 'none') return { kind: 'none', geojson: null, placeLabel: null };
  const geom: ObjectGeometry =
    loc.geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: [closeRing(loc.geometry.coordinates[0]!)] } : loc.geometry;
  if (loc.kind === 'point' && geom.type !== 'Point') throw badRequest('geometry_mismatch');
  if (loc.kind === 'area' && geom.type !== 'Polygon') throw badRequest('geometry_mismatch');
  const err = validateObjectGeometry(geom, ctx.env.MAX_AREA_KM2);
  if (err) throw unprocessable(err.replace('geo.error.', 'geometry_'), err, { i18n_key: err });
  const [lon, lat] = geom.type === 'Point' ? geom.coordinates : centroidOf(geom.coordinates[0]!);
  return { kind: loc.kind, geojson: JSON.stringify(geom), placeLabel: loc.place_label ?? null, lat, lon };
}

function centroidOf(ring: [number, number][]): [number, number] {
  const pts = ring.slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

async function municipalityFor(ctx: Ctx, loc: LocationSql): Promise<{ municipality_no: string | null; county_no: string | null }> {
  if (loc.lat === undefined || loc.lon === undefined) return { municipality_no: null, county_no: null };
  try {
    return await ctx.providers.geocoder.municipality(loc.lat, loc.lon);
  } catch (err) {
    ctx.log.warn({ err: (err as Error).message }, 'municipality lookup failed');
    return { municipality_no: null, county_no: null };
  }
}

const GEOM_SQL = (p: string) => `case when ${p}::text is null then null else st_geomfromgeojson(${p}::text)::geography end`;

async function assertValidPostgis(db: Db, geojson: string | null) {
  if (!geojson) return;
  const r = await one<{ valid: boolean }>(db, 'select st_isvalid(st_geomfromgeojson($1::text)) as valid', [geojson]);
  if (!r?.valid) throw unprocessable('geometry_selfIntersects', 'geometry is not valid', { i18n_key: 'geo.error.selfIntersects' });
}

// ---------------------------------------------------------------- commands

export async function createObject(ctx: Ctx, actor: Actor, input: ObjectCreate, opts: { db?: Db } = {}): Promise<string> {
  if (!can(actor, 'manage_objects')) throw forbidden('proposal_required', 'members send a proposal instead');
  const ref = await loadReference(ctx.pool);
  const typeKey = input.type_key ?? null;
  validateType(ref, typeKey);
  const statusKey = input.status_key ?? 'normal';
  validateStatus(ref, typeKey, statusKey);
  validateSituations(ref, typeKey, input.situations);
  const temp = statusKey !== 'normal';
  const until = temp ? validateUntil(ctx, input.status_until) : null;
  const loc = prepareLocation(ctx, input.location ?? { kind: 'none' });
  const muni = await municipalityFor(ctx, loc);

  const run = async (db: Db) => {
    const account = await getAccount(db, actor.accountId, true);
    const plan = await getPlan(db, account.plan_key);
    const count = await one<{ n: number }>(db, 'select count(*)::int as n from objects where account_id = $1 and deleted_at is null', [actor.accountId]);
    if (!plan || count!.n >= plan.max_objects) throw conflict('plan_limit_objects', 'object limit reached for the plan');
    await assertValidPostgis(db, loc.geojson);
    const row = await one<{ id: string }>(
      db,
      `insert into objects(account_id, nickname, type_key, status_key, status_until, status_set_by, status_version, location_kind, geom,
                           place_label, county_no, municipality_no, created_by)
       values ($1,$2,$3,$4,$5,$6,0,$7,${GEOM_SQL('$8')},$9,$10,$11,$12) returning id`,
      [actor.accountId, input.nickname || null, typeKey, statusKey, until, temp ? actor.id : null, loc.kind, loc.geojson, loc.placeLabel,
        muni.county_no, muni.municipality_no, actor.id],
    );
    for (const s of input.situations ?? []) {
      await db.query('insert into object_situations(object_id, situation_key, sensitivity) values ($1,$2,$3)', [row!.id, s.situation_key, s.sensitivity]);
    }
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'object.create', targetType: 'object', targetId: row!.id, metadata: { type_key: typeKey, location_kind: loc.kind } });
    return row!.id;
  };
  const id = opts.db ? await run(opts.db) : await withTx(ctx.pool, run);
  if (temp && until) await afterStatusChange(ctx, actor, id, statusKey, until, 0);
  return id;
}

export async function updateObject(ctx: Ctx, actor: Actor, id: string, patch: ObjectPatch): Promise<void> {
  if (!can(actor, 'manage_objects')) throw forbidden('proposal_required', 'members send a proposal instead');
  const ref = await loadReference(ctx.pool);
  const current = await getObjectRow(ctx, ctx.pool, actor, id);
  const typeKey = patch.type_key === undefined ? current.type_key : patch.type_key;
  validateType(ref, typeKey);
  if (patch.type_key !== undefined) {
    validateStatus(ref, typeKey, current.status_key);
    validateStatus(ref, typeKey, current.normal_status_key);
    validateSituations(ref, typeKey, current.situations);
  }
  const loc = patch.location ? prepareLocation(ctx, patch.location) : null;
  const muni = loc ? await municipalityFor(ctx, loc) : null;
  await withTx(ctx.pool, async (db) => {
    if (loc) await assertValidPostgis(db, loc.geojson);
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [id, actor.accountId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      sets.push(sql.replace('?', `$${params.length}`));
    };
    if (patch.nickname !== undefined) add('nickname = ?', patch.nickname || null);
    if (patch.type_key !== undefined) add('type_key = ?', patch.type_key ?? null);
    if (loc) {
      add('location_kind = ?', loc.kind);
      params.push(loc.geojson);
      sets.push(`geom = ${GEOM_SQL(`$${params.length}`)}`);
      add('place_label = ?', loc.placeLabel);
      add('county_no = ?', muni!.county_no);
      add('municipality_no = ?', muni!.municipality_no);
    }
    await db.query(`update objects set ${sets.join(', ')} where id = $1 and account_id = $2 and deleted_at is null`, params);
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'object.update', targetType: 'object', targetId: id, metadata: { fields: Object.keys(patch) } });
  });
}

export async function deleteObject(ctx: Ctx, actor: Actor, id: string): Promise<void> {
  assertCan(actor, 'delete_objects');
  await withTx(ctx.pool, async (db) => {
    const r = await db.query('update objects set deleted_at = now(), updated_at = now() where id = $1 and account_id = $2 and deleted_at is null', [id, actor.accountId]);
    if (!r.rowCount) throw notFound('object');
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'object.delete', targetType: 'object', targetId: id });
  });
}

export async function setSituations(ctx: Ctx, actor: Actor, id: string, situations: { situation_key: string; sensitivity: Sensitivity }[]): Promise<void> {
  if (!can(actor, 'manage_objects')) throw forbidden('proposal_required', 'members send a proposal instead');
  const ref = await loadReference(ctx.pool);
  const current = await getObjectRow(ctx, ctx.pool, actor, id);
  validateSituations(ref, current.type_key, situations);
  await withTx(ctx.pool, async (db) => {
    await db.query('delete from object_situations where object_id = $1', [id]);
    for (const s of situations) {
      await db.query('insert into object_situations(object_id, situation_key, sensitivity) values ($1,$2,$3)', [id, s.situation_key, s.sensitivity]);
    }
    await db.query('update objects set updated_at = now() where id = $1', [id]);
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'object.situations', targetType: 'object', targetId: id, metadata: { situations } });
  });
}

const MAX_STATUS_DAYS = 365;

function validateUntil(ctx: Ctx, until: string | undefined): Date {
  if (!until) throw unprocessable('status_until_required', 'a temporary status needs an expected end time');
  const d = new Date(until);
  const now = ctx.now();
  if (d <= now) throw unprocessable('status_until_past', 'end time must be in the future');
  if (d.getTime() - now.getTime() > MAX_STATUS_DAYS * 86_400_000) throw unprocessable('status_until_too_far');
  return d;
}

/** Any user may set a temporary status (with an end time) or return to the object's normal. */
export async function setStatus(ctx: Ctx, actor: Actor, id: string, statusKey: string, until: string | undefined): Promise<void> {
  assertCan(actor, 'set_status');
  const ref = await loadReference(ctx.pool);
  const current = await getObjectRow(ctx, ctx.pool, actor, id);
  validateStatus(ref, current.type_key, statusKey);
  const toNormal = statusKey === current.normal_status_key;
  const untilDate = toNormal ? null : validateUntil(ctx, until);
  const version = await withTx(ctx.pool, async (db) => {
    const r = await one<{ status_version: number }>(
      db,
      `update objects set status_key = $3, status_until = $4, status_set_by = $5, status_version = status_version + 1, updated_at = now()
       where id = $1 and account_id = $2 and deleted_at is null returning status_version`,
      [id, actor.accountId, statusKey, untilDate, toNormal ? null : actor.id],
    );
    if (!r) throw notFound('object');
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'object.status', targetType: 'object', targetId: id, metadata: { status_key: statusKey, until: iso(untilDate) } });
    return r.status_version;
  });
  if (untilDate) await afterStatusChange(ctx, actor, id, statusKey, untilDate, version);
  else await notifyOthers(ctx, actor, id, 'msg.statusReverted', { status: statusI18n(ref, statusKey) });
}

export async function extendStatus(ctx: Ctx, actor: Actor, id: string, until: string): Promise<void> {
  assertCan(actor, 'set_status');
  const current = await getObjectRow(ctx, ctx.pool, actor, id);
  if (current.status_key === current.normal_status_key) throw conflict('status_is_normal', 'the object has no temporary status to extend');
  const untilDate = validateUntil(ctx, until);
  const version = await withTx(ctx.pool, async (db) => {
    const r = await one<{ status_version: number }>(
      db,
      `update objects set status_until = $3, status_set_by = $4, status_version = status_version + 1, updated_at = now()
       where id = $1 and account_id = $2 and deleted_at is null returning status_version`,
      [id, actor.accountId, untilDate, actor.id],
    );
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'object.status_extend', targetType: 'object', targetId: id, metadata: { until: iso(untilDate) } });
    return r!.status_version;
  });
  await afterStatusChange(ctx, actor, id, current.status_key, untilDate, version);
}

export async function setNormalStatus(ctx: Ctx, actor: Actor, id: string, statusKey: string): Promise<void> {
  assertCan(actor, 'set_normal_status');
  const ref = await loadReference(ctx.pool);
  const current = await getObjectRow(ctx, ctx.pool, actor, id);
  validateStatus(ref, current.type_key, statusKey);
  await withTx(ctx.pool, async (db) => {
    const atNormal = current.status_key === current.normal_status_key;
    await db.query(
      `update objects set normal_status_key = $2, ${atNormal ? 'status_key = $2, status_until = null, status_set_by = null, status_version = status_version + 1,' : ''} updated_at = now() where id = $1`,
      [id, statusKey],
    );
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'object.normal_status', targetType: 'object', targetId: id, metadata: { status_key: statusKey } });
  });
}

async function afterStatusChange(ctx: Ctx, actor: Actor, objectId: string, statusKey: string, until: Date, version: number) {
  const ref = await loadReference(ctx.pool);
  await ctx.jobs.send('status.expire', { objectId, version }, { startAfter: until });
  await notifyOthers(ctx, actor, objectId, 'msg.statusChanged', {
    actor: actor.name,
    status: statusI18n(ref, statusKey),
    until: { time: until.toISOString() },
  });
}

async function notifyOthers(ctx: Ctx, actor: Actor, objectId: string, bodyKey: 'msg.statusChanged' | 'msg.statusReverted', params: Record<string, InfoParam>) {
  const users = await many<{ id: string }>(ctx.pool, 'select id from users where account_id = $1 and removed_at is null and id <> $2', [actor.accountId, actor.id]);
  if (!users.length) return;
  const o = await one<{ nickname: string | null; type_key: string | null; place_label: string | null }>(ctx.pool, 'select nickname, type_key, place_label from objects where id = $1', [objectId]);
  const ref = await loadReference(ctx.pool);
  await ctx.jobs.send('info.push', {
    userIds: users.map((u) => u.id),
    bodyKey,
    params: { ...params, object: objectDisplayName(o?.nickname, typeName(ref, o?.type_key ?? null, 'nb'), o?.place_label ?? null, 'Objekt') },
    data: { object_id: objectId, url: `varsling://objects/${objectId}` },
  });
}

export function objectCanFlags(actor: Actor) {
  return { can_edit: can(actor, 'manage_objects'), can_delete: can(actor, 'delete_objects'), can_set_normal: can(actor, 'set_normal_status') };
}

export { AppError };
