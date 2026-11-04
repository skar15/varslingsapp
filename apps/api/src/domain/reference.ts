import { createHash } from 'node:crypto';
import type { LevelMapRow, ReferenceSets } from '@varsling/shared';
import { many, type Db } from '../db/client';

export interface I18n {
  nb: string;
  en?: string;
}
export interface SituationRow { key: string; i18n: I18n; available: boolean; sort: number }
export interface TypeRow { key: string; i18n: I18n; defaults: string[]; category: string; icon: string; sort: number }
export interface StatusRow { key: string; i18n: I18n; adds: string[]; removes: string[]; applies_to: string[] | null; sort: number }
export interface AdviceRow { key: string; situation_key: string; status_key: string | null; category: string | null; i18n: I18n }

export interface Reference extends ReferenceSets {
  situations: SituationRow[];
  types: TypeRow[];
  statuses: StatusRow[];
  levelMap: LevelMapRow[];
  eventMap: { source: string; event: string; situation_key: string }[];
  advice: AdviceRow[];
  etag: string;
}

let cache: { at: number; value: Reference } | null = null;
const TTL_MS = 60_000;

export function clearReferenceCache() {
  cache = null;
}

export async function loadReference(db: Db): Promise<Reference> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const [situations, types, statuses, levelMap, eventMap, advice] = await Promise.all([
    many<SituationRow>(db, 'select key, i18n, available, sort from situation_types order by sort, key'),
    many<TypeRow>(db, 'select key, i18n, defaults, category, icon, sort from object_types order by sort, key'),
    many<StatusRow>(db, 'select key, i18n, adds, removes, applies_to, sort from object_statuses order by sort, key'),
    many<LevelMapRow>(db, 'select source, source_level, level from level_map'),
    many<{ source: string; event: string; situation_key: string }>(db, 'select source, event, situation_key from event_map'),
    many<AdviceRow>(db, 'select key, situation_key, status_key, category, i18n from advice order by key'),
  ]);
  const etag = `"${createHash('sha1').update(JSON.stringify([situations, types, statuses])).digest('hex').slice(0, 16)}"`;
  const value: Reference = { situations, types, statuses, levelMap, eventMap, advice, etag };
  cache = { at: Date.now(), value };
  return value;
}

export function situationName(ref: Reference, key: string | null, locale: 'nb' | 'en'): string {
  const s = ref.situations.find((x) => x.key === key);
  if (!s) return key ?? '';
  return (locale === 'en' ? s.i18n.en : undefined) ?? s.i18n.nb;
}

export function typeName(ref: Reference, key: string | null, locale: 'nb' | 'en'): string | null {
  const s = ref.types.find((x) => x.key === key);
  if (!s) return null;
  return (locale === 'en' ? s.i18n.en : undefined) ?? s.i18n.nb;
}

export function statusI18n(ref: Reference, key: string): I18n {
  return ref.statuses.find((x) => x.key === key)?.i18n ?? { nb: key };
}

/** Advice for an object and situation: status-specific first, then by object category. */
export function adviceFor(ref: Reference, situationKey: string | null, statusKey: string, typeKey: string | null, locale: 'nb' | 'en'): string[] {
  if (!situationKey) return [];
  const category = ref.types.find((t) => t.key === typeKey)?.category ?? null;
  const pick = (r: AdviceRow) => (locale === 'en' ? r.i18n.en : undefined) ?? r.i18n.nb;
  const byStatus = ref.advice.filter((a) => a.situation_key === situationKey && a.status_key === statusKey);
  const byCategory = ref.advice.filter((a) => a.situation_key === situationKey && !a.status_key && a.category && a.category === category);
  return [...byStatus, ...byCategory].map(pick);
}
