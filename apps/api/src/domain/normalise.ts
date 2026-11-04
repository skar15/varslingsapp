import { colourFromSeverity, mapSourceLevel, normaliseSourceLevel, type AlertLevel, type LevelMapRow } from '@varsling/shared';
import { pickInfo, type CapAlert, type CapReference } from '../sources/cap';

export interface NormalisedAlert {
  source: string;
  sourceId: string;
  msgType: 'alert' | 'update' | 'cancel';
  capStatus: string;
  responseType: string | null;
  severity: string | null;
  references: CapReference[];
  eventKey: string;
  situationKey: string | null;
  sourceLevel: string;
  level: AlertLevel | null;
  onset: string | null;
  expires: string | null;
  sentAt: string;
  /** Rings in [lon, lat]. Unioned and made valid in PostGIS. */
  polygons: [number, number][][];
  areaNb: string | null;
  titleNb: string | null;
  titleEn: string | null;
  descriptionNb: string | null;
  descriptionEn: string | null;
  instructionNb: string | null;
  instructionEn: string | null;
  webUrl: string | null;
}

/** NVE CAP files carry the hazard in the feed itself; the event key defaults per source. */
const SOURCE_DEFAULT_EVENT: Record<string, string> = { 'nve-flood': 'flood', 'nve-landslide': 'landslide' };

export interface NormaliseMaps {
  levelMap: LevelMapRow[];
  eventMap: { source: string; event: string; situation_key: string }[];
}

/**
 * Stage 2 of the pipeline. Pure: CAP in, normalised alert out.
 * - Norwegian info block preferred, English as fallback.
 * - Event from eventCode valueName=eventType.
 * - Level from awareness_level, else severity: yellow -> YELLOW, orange/red -> RED.
 * - Cancel and AllClear get level null.
 */
export function normaliseCap(cap: CapAlert, source: string, maps: NormaliseMaps): NormalisedAlert {
  const { nb, en, primary } = pickInfo(cap);
  if (!primary) throw new Error('CAP alert without info block');
  const mapSource = source === 'sim' ? 'met' : source;

  const rawEvent = primary.eventType ?? en?.eventType ?? null;
  const defaultEvent = SOURCE_DEFAULT_EVENT[source];
  const mapped = (ev: string | null) => (ev ? maps.eventMap.find((e) => e.source === mapSource && e.event === ev)?.situation_key ?? null : null);
  let eventKey = rawEvent ?? defaultEvent ?? primary.event ?? 'unknown';
  let situationKey = mapped(eventKey);
  if (!situationKey && defaultEvent) {
    situationKey = mapped(defaultEvent);
    if (situationKey && !rawEvent) eventKey = defaultEvent;
  }

  const msgType = cap.msgType.toLowerCase() === 'cancel' ? 'cancel' : cap.msgType.toLowerCase() === 'update' ? 'update' : 'alert';
  const responseType = primary.responseType ?? en?.responseType ?? null;
  const colour = normaliseSourceLevel(primary.awarenessLevel ?? en?.awarenessLevel ?? '') ?? colourFromSeverity(primary.severity ?? undefined);
  const isClear = msgType === 'cancel' || (responseType ?? '').toLowerCase() === 'allclear';
  const level = isClear || !colour ? null : (mapSourceLevel(maps.levelMap, source, colour) ?? null);

  const areas = primary.areas.length ? primary.areas : (en?.areas ?? []);
  return {
    source,
    sourceId: cap.identifier,
    msgType,
    capStatus: cap.status,
    responseType,
    severity: primary.severity,
    references: cap.references,
    eventKey,
    situationKey,
    sourceLevel: colour ?? 'unknown',
    level,
    onset: primary.onset ?? primary.effective ?? null,
    expires: primary.expires ?? en?.expires ?? null,
    sentAt: cap.sent,
    polygons: areas.flatMap((a) => a.polygons),
    areaNb: nb?.areas.map((a) => a.areaDesc).filter(Boolean).join(', ') || areas.map((a) => a.areaDesc).join(', ') || null,
    titleNb: nb?.headline ?? null,
    titleEn: en?.headline ?? null,
    descriptionNb: nb?.description ?? null,
    descriptionEn: en?.description ?? null,
    instructionNb: nb?.instruction ?? null,
    instructionEn: en?.instruction ?? null,
    webUrl: primary.web ?? en?.web ?? null,
  };
}

/** Chain root: the earliest referenced identifier, or the alert itself (pipeline stage 3). */
export function chainRootFromReferences(own: string, refs: CapReference[]): string {
  if (!refs.length) return own;
  const sorted = [...refs].sort((a, b) => Date.parse(a.sent) - Date.parse(b.sent));
  return sorted[0]!.identifier;
}
