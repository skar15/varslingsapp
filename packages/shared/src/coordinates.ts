/**
 * Coordinate parser for the location picker. Accepts:
 *  - decimal degrees:          69.3218, 16.1234   |  N69.3218 E16.1234   |  69,3218 16,1234
 *  - degrees + decimal minutes: 69° 19.308' N 16° 7.404' E
 *  - degrees minutes seconds:   69°19'18.5"N 16°07'24.2"E
 *  - UTM zones 32, 33, 35 (ETRS89): "33W 600000 7650000", "UTM 33 N 7650000 Ø 600000", "sone 32 597000 6643000"
 * Norwegian hemisphere letters Ø (øst) and V (vest) are accepted.
 * Returns WGS 84 (ETRS89 differs by well under a metre for this use).
 */

export type CoordinateFormat = 'dd' | 'dm' | 'dms' | 'utm';

export type ParseResult =
  | { ok: true; lat: number; lon: number; format: CoordinateFormat; zone?: number; swapped?: boolean }
  | { ok: false; error: CoordinateError };

export type CoordinateError =
  | 'coord.error.empty'
  | 'coord.error.unrecognised'
  | 'coord.error.range'
  | 'coord.error.outsideNorway'
  | 'coord.error.utmZone';

export const SUPPORTED_UTM_ZONES = [32, 33, 35] as const;

/** Rough bounding box for mainland Norway, Svalbard and Jan Mayen. */
export function isInNorway(lat: number, lon: number): boolean {
  return lat >= 57 && lat <= 81.5 && lon >= -9.5 && lon <= 34;
}

export function parseCoordinates(input: string): ParseResult {
  const s = normalise(input);
  if (!s) return { ok: false, error: 'coord.error.empty' };
  const numbers = [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => toNumber(m[0]));
  if (numbers.some((n) => n >= 100000)) return parseUtm(s);
  return parseGeographic(s);
}

function normalise(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[′’‘`´]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/''/g, '"')
    .replace(/[º˚]/g, '°')
    .replace(/(?<![A-ZÆØÅ])(SØR|SYD)(?![A-ZÆØÅ])/g, 'S')
    .replace(/(?<![A-ZÆØÅ])ØST(?![A-ZÆØÅ])/g, 'E')
    .replace(/(?<![A-ZÆØÅ])NORD(?![A-ZÆØÅ])/g, 'N')
    .replace(/(?<![A-ZÆØÅ])VEST(?![A-ZÆØÅ])/g, 'V')
    .replace(/Ø|Ö/g, 'E')
    .replace(/\s+/g, ' ');
}

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

// ---------------------------------------------------------------- geographic

type Unit = 'd' | 'm' | 's';
interface Part {
  value: number;
  negative: boolean;
  unit?: Unit;
}
interface Group {
  parts: Part[];
  hem?: 'N' | 'S' | 'E' | 'W';
}

function parseGeographic(s: string): ParseResult {
  // Letters other than hemisphere letters (and words like LAT/LON/NORD/ØST) are not allowed.
  const cleaned = s
    .replace(/\b(LAT|LON|LONG|LATITUDE|LONGITUDE|BREDDE|LENGDE)\b/g, ' ')
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bWEST\b/g, 'W')
    .replace(/(?<![A-Z])V(?![A-Z])/g, 'W');
  if (/[A-DF-MO-RT-VX-Z]/.test(cleaned)) return { ok: false, error: 'coord.error.unrecognised' };

  const tokens: ({ t: 'num'; v: number; neg: boolean } | { t: 'hem'; v: 'N' | 'S' | 'E' | 'W' } | { t: 'unit'; v: Unit })[] = [];
  const hasDot = cleaned.includes('.');
  const numRe = hasDot ? /-?\d+(?:\.\d+)?/y : /-?\d+(?:,\d+)?/y;
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i]!;
    if (/[\d-]/.test(ch)) {
      numRe.lastIndex = i;
      const m = numRe.exec(cleaned);
      if (!m) return { ok: false, error: 'coord.error.unrecognised' };
      const raw = m[0];
      tokens.push({ t: 'num', v: Math.abs(toNumber(raw)), neg: raw.startsWith('-') });
      i += raw.length;
      continue;
    }
    if ('NSEW'.includes(ch)) tokens.push({ t: 'hem', v: ch as 'N' | 'S' | 'E' | 'W' });
    else if (ch === '°') tokens.push({ t: 'unit', v: 'd' });
    else if (ch === "'") tokens.push({ t: 'unit', v: 'm' });
    else if (ch === '"') tokens.push({ t: 'unit', v: 's' });
    else if (!/[\s,;/]/.test(ch)) return { ok: false, error: 'coord.error.unrecognised' };
    i++;
  }

  // Attach units to the preceding number.
  const items: ({ kind: 'part'; part: Part } | { kind: 'hem'; hem: 'N' | 'S' | 'E' | 'W' })[] = [];
  for (const tok of tokens) {
    if (tok.t === 'num') items.push({ kind: 'part', part: { value: tok.v, negative: tok.neg } });
    else if (tok.t === 'hem') items.push({ kind: 'hem', hem: tok.v });
    else {
      const last = items[items.length - 1];
      if (!last || last.kind !== 'part' || last.part.unit) return { ok: false, error: 'coord.error.unrecognised' };
      last.part.unit = tok.v;
    }
  }

  const groups = buildGroups(items);
  if (!groups || groups.length !== 2) return { ok: false, error: 'coord.error.unrecognised' };

  let format: CoordinateFormat = 'dd';
  const values: { value: number; hem?: Group['hem'] }[] = [];
  for (const g of groups) {
    const r = groupValue(g);
    if (r === null) return { ok: false, error: 'coord.error.unrecognised' };
    if (r.format === 'dms' || (r.format === 'dm' && format === 'dd')) format = r.format;
    values.push({ value: r.value, hem: g.hem });
  }

  let lat: number;
  let lon: number;
  let swapped = false;
  const [a, b] = values as [{ value: number; hem?: Group['hem'] }, { value: number; hem?: Group['hem'] }];
  const isLat = (h?: Group['hem']) => h === 'N' || h === 'S';
  const isLon = (h?: Group['hem']) => h === 'E' || h === 'W';
  if (isLat(a.hem) || isLon(b.hem)) {
    if (isLat(b.hem) || isLon(a.hem)) return { ok: false, error: 'coord.error.unrecognised' };
    lat = a.value;
    lon = b.value;
  } else if (isLon(a.hem) || isLat(b.hem)) {
    lat = b.value;
    lon = a.value;
  } else {
    lat = a.value;
    lon = b.value;
    // Without hemisphere letters the order is ambiguous. In Norway latitude is always > 57
    // and longitude < 35, so a reversed pair is unambiguous: swap and report it.
    if (!isInNorway(lat, lon) && isInNorway(lon, lat)) {
      [lat, lon] = [lon, lat];
      swapped = true;
    }
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, error: 'coord.error.range' };
  if (!isInNorway(lat, lon)) return { ok: false, error: 'coord.error.outsideNorway' };
  return { ok: true, lat: round(lat), lon: round(lon), format, ...(swapped ? { swapped } : {}) };
}

function buildGroups(items: ({ kind: 'part'; part: Part } | { kind: 'hem'; hem: 'N' | 'S' | 'E' | 'W' })[]): Group[] | null {
  const hasHem = items.some((x) => x.kind === 'hem');
  const groups: Group[] = [];
  if (hasHem) {
    const prefix = items[0]?.kind === 'hem';
    let cur: Group = { parts: [] };
    for (const it of items) {
      if (it.kind === 'hem') {
        if (prefix) {
          if (cur.parts.length || cur.hem) groups.push(cur);
          cur = { parts: [], hem: it.hem };
        } else {
          if (!cur.parts.length || cur.hem) return null;
          cur.hem = it.hem;
          groups.push(cur);
          cur = { parts: [] };
        }
      } else cur.parts.push(it.part);
    }
    if (cur.parts.length || cur.hem) groups.push(cur);
    return groups;
  }
  const parts = items.flatMap((x) => (x.kind === 'part' ? [x.part] : []));
  if (parts.some((p) => p.unit === 'd')) {
    let cur: Group | null = null;
    for (const p of parts) {
      if (p.unit === 'd' || !cur) {
        if (cur) groups.push(cur);
        cur = { parts: [] };
      }
      cur.parts.push(p);
    }
    if (cur) groups.push(cur);
    return groups;
  }
  if (parts.length % 2 !== 0 || parts.length === 0 || parts.length > 6) return null;
  const half = parts.length / 2;
  return [{ parts: parts.slice(0, half) }, { parts: parts.slice(half) }];
}

function groupValue(g: Group): { value: number; format: CoordinateFormat } | null {
  const [d, m, sec] = g.parts;
  if (!d || g.parts.length > 3) return null;
  if (m && (m.value >= 60 || !Number.isInteger(d.value))) return null;
  if (sec && (sec.value >= 60 || !Number.isInteger(m!.value))) return null;
  let value = d.value + (m ? m.value / 60 : 0) + (sec ? sec.value / 3600 : 0);
  if (d.negative || g.hem === 'S' || g.hem === 'W') value = -value;
  return { value, format: sec ? 'dms' : m ? 'dm' : 'dd' };
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

// ---------------------------------------------------------------- UTM

function parseUtm(s: string): ParseResult {
  const zoneMatch = /(?:^|\b(?:UTM|SONE|ZONE)\s*)(\d{1,2})([C-X])?(?=[\s,;:]|$)/.exec(s);
  if (!zoneMatch) return { ok: false, error: 'coord.error.unrecognised' };
  const zone = Number(zoneMatch[1]);
  if (!(SUPPORTED_UTM_ZONES as readonly number[]).includes(zone)) return { ok: false, error: 'coord.error.utmZone' };
  const band = zoneMatch[2];
  if (band && band < 'N') return { ok: false, error: 'coord.error.outsideNorway' };
  const rest = s.slice(zoneMatch.index + zoneMatch[0].length);
  const nums = [...rest.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => toNumber(m[0]));
  if (nums.length !== 2) return { ok: false, error: 'coord.error.unrecognised' };
  const easting = nums.find((n) => n >= 100000 && n < 1000000);
  const northing = nums.find((n) => n >= 1000000 && n < 10000000);
  if (easting === undefined || northing === undefined) return { ok: false, error: 'coord.error.range' };
  const { lat, lon } = utmToLatLon(zone, easting, northing);
  if (!isInNorway(lat, lon)) return { ok: false, error: 'coord.error.outsideNorway' };
  return { ok: true, lat: round(lat), lon: round(lon), format: 'utm', zone };
}

// GRS80 ellipsoid (ETRS89).
const A = 6378137;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;

function centralMeridian(zone: number): number {
  return ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
}

/** Inverse transverse Mercator (Snyder 1987), northern hemisphere. */
export function utmToLatLon(zone: number, easting: number, northing: number): { lat: number; lon: number } {
  const x = easting - 500000;
  const M = northing / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const C1 = EP2 * cos1 ** 2;
  const T1 = tan1 ** 2;
  const N1 = A / Math.sqrt(1 - E2 * sin1 ** 2);
  const R1 = (A * (1 - E2)) / (1 - E2 * sin1 ** 2) ** 1.5;
  const D = x / (N1 * K0);
  const lat =
    phi1 -
    ((N1 * tan1) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * EP2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lon =
    centralMeridian(zone) +
    (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * EP2 + 24 * T1 ** 2) * D ** 5) / 120) / cos1;
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** Forward transverse Mercator (Snyder 1987), northern hemisphere. */
export function latLonToUtm(lat: number, lon: number, zone: number): { easting: number; northing: number } {
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * sin ** 2);
  const T = tan ** 2;
  const C = EP2 * cos ** 2;
  const Aa = cos * (lam - centralMeridian(zone));
  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
  const easting =
    K0 * N * (Aa + ((1 - T + C) * Aa ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * Aa ** 5) / 120) + 500000;
  const northing =
    K0 *
    (M +
      N *
        tan *
        (Aa ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * Aa ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * Aa ** 6) / 720));
  return { easting, northing };
}
