import type { AlertLevel, Light, Sensitivity } from './enums';

const RANK: Record<AlertLevel, number> = { green: 1, yellow: 2, red: 3 };

export function levelRank(level: AlertLevel | null | undefined): number {
  return level ? RANK[level] : 0;
}

export function maxLevel(levels: Iterable<AlertLevel | null | undefined>): AlertLevel | null {
  let best: AlertLevel | null = null;
  for (const l of levels) if (l && levelRank(l) > levelRank(best)) best = l;
  return best;
}

export function lightFor(level: AlertLevel | null): Light {
  return level ?? 'none';
}

/** Lowest level that triggers a notification for each sensitivity. */
const SENSITIVITY_THRESHOLD: Record<Sensitivity, AlertLevel> = {
  high: 'green',
  medium: 'yellow',
  low: 'red',
};

/**
 * Does `level` meet the notification threshold for `sensitivity`?
 * Until M6 no GREEN alerts exist, so HIGH behaves exactly like MEDIUM (D2).
 */
export function meetsSensitivity(level: AlertLevel, sensitivity: Sensitivity): boolean {
  return levelRank(level) >= levelRank(SENSITIVITY_THRESHOLD[sensitivity]);
}

export interface LevelMapRow {
  source: string; // '*' matches every source
  source_level: string;
  level: AlertLevel | null;
}

/**
 * Map an issuer colour (yellow/orange/red, or an awareness_level string such as
 * "3; orange; Severe") to the app level using the config table (D2, D3).
 * Returns undefined when the colour is unknown.
 */
export function mapSourceLevel(rows: LevelMapRow[], source: string, sourceLevel: string): AlertLevel | null | undefined {
  const colour = normaliseSourceLevel(sourceLevel);
  if (!colour) return undefined;
  const exact = rows.find((r) => r.source === source && r.source_level === colour);
  if (exact) return exact.level;
  const wildcard = rows.find((r) => r.source === '*' && r.source_level === colour);
  return wildcard ? wildcard.level : undefined;
}

const COLOURS = ['green', 'yellow', 'orange', 'red'] as const;
const NUMERIC: Record<string, (typeof COLOURS)[number]> = { '1': 'green', '2': 'yellow', '3': 'orange', '4': 'red' };

/** "2; yellow; Moderate" -> "yellow". "Orange" -> "orange". "3" -> "orange". */
export function normaliseSourceLevel(raw: string): string | null {
  const parts = raw.toLowerCase().split(/[;,\s]+/).filter(Boolean);
  for (const p of parts) if ((COLOURS as readonly string[]).includes(p)) return p;
  for (const p of parts) if (NUMERIC[p]) return NUMERIC[p]!;
  return null;
}

/** CAP severity fallback when awareness_level is missing. */
export function colourFromSeverity(severity: string | undefined): string | null {
  switch ((severity ?? '').toLowerCase()) {
    case 'moderate':
      return 'yellow';
    case 'severe':
      return 'orange';
    case 'extreme':
      return 'red';
    default:
      return null;
  }
}
