import type { AlertLevel, Sensitivity } from './enums';
import { meetsSensitivity } from './levels';

export interface RefSituation {
  key: string;
  available: boolean;
}
export interface RefObjectType {
  key: string;
  defaults: string[];
  category?: string;
}
export interface RefStatus {
  key: string;
  adds: string[];
  removes: string[];
  applies_to: string[] | null;
}
export interface ReferenceSets {
  situations: RefSituation[];
  types: RefObjectType[];
  statuses: RefStatus[];
}

export interface ObjectMonitoringInput {
  type_key: string | null;
  status_key: string;
  /** Explicit object_situations rows. Empty = use type and status defaults. */
  situations: { situation_key: string; sensitivity: Sensitivity }[];
}

export interface MonitoredSituation {
  key: string;
  sensitivity: Sensitivity;
  /** True when the active status added this situation. Effective sensitivity is then HIGH. */
  addedByStatus: boolean;
  effectiveSensitivity: Sensitivity;
}

/**
 * The monitored set: explicit rows, or if none, the type defaults plus the status
 * `adds`, minus the status `removes`. With no type, every available situation.
 * The status adds are applied on top of explicit rows too, because a status
 * "adds situation types to what is monitored" (spec, object statuses).
 * Unavailable situation types (D4) are never monitored.
 */
export function monitoredSet(obj: ObjectMonitoringInput, ref: ReferenceSets): Map<string, MonitoredSituation> {
  const available = new Set(ref.situations.filter((s) => s.available).map((s) => s.key));
  const status = ref.statuses.find((s) => s.key === obj.status_key);
  const adds = new Set(status?.adds ?? []);
  const removes = new Set(status?.removes ?? []);
  const result = new Map<string, MonitoredSituation>();

  const put = (key: string, sensitivity: Sensitivity, addedByStatus: boolean) => {
    if (!available.has(key) || removes.has(key)) return;
    result.set(key, { key, sensitivity, addedByStatus, effectiveSensitivity: addedByStatus ? 'high' : sensitivity });
  };

  if (obj.situations.length > 0) {
    for (const s of obj.situations) put(s.situation_key, s.sensitivity, adds.has(s.situation_key));
  } else {
    const type = obj.type_key ? ref.types.find((t) => t.key === obj.type_key) : undefined;
    const defaults = obj.type_key ? (type?.defaults ?? []) : [...available];
    for (const k of defaults) put(k, 'high', adds.has(k));
  }
  for (const k of adds) if (!result.has(k)) put(k, 'high', true);
  return result;
}

/** Is a notification due for this situation and level on this object? */
export function shouldNotify(set: Map<string, MonitoredSituation>, situationKey: string | null, level: AlertLevel | null): boolean {
  if (!situationKey || !level) return false;
  const m = set.get(situationKey);
  return !!m && meetsSensitivity(level, m.effectiveSensitivity);
}

/** Statuses that may be chosen for an object type. */
export function statusesForType(ref: ReferenceSets, typeKey: string | null): RefStatus[] {
  return ref.statuses.filter((s) => !s.applies_to || (typeKey !== null && s.applies_to.includes(typeKey)));
}

/** Situation types the add/edit form suggests (pre-ticked) for a type and status. */
export function suggestedSituations(ref: ReferenceSets, typeKey: string | null, statusKey: string): string[] {
  return [...monitoredSet({ type_key: typeKey, status_key: statusKey, situations: [] }, ref).keys()];
}
