import { XMLParser } from 'fast-xml-parser';

export interface CapReference {
  sender: string;
  identifier: string;
  sent: string;
}

export interface CapArea {
  areaDesc: string;
  /** Rings in GeoJSON order [lon, lat], closed. CAP lists latitude first; swapped here (schema rule 2). */
  polygons: [number, number][][];
}

export interface CapInfo {
  language: string;
  event: string;
  eventType: string | null;
  responseType: string | null;
  severity: string | null;
  certainty: string | null;
  onset: string | null;
  effective: string | null;
  expires: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  web: string | null;
  awarenessLevel: string | null;
  parameters: Record<string, string>;
  areas: CapArea[];
}

export interface CapAlert {
  identifier: string;
  sender: string;
  sent: string;
  status: string;
  msgType: 'Alert' | 'Update' | 'Cancel' | string;
  references: CapReference[];
  infos: CapInfo[];
}

const ARRAYS = new Set(['info', 'area', 'polygon', 'parameter', 'eventCode', 'resource', 'geocode', 'responseType', 'alert', 'item', 'entry']);

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

type Node = Record<string, unknown>;
const text = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : typeof v === 'object' ? (((v as Node)['#text'] as string) ?? null) : String(v));
const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : v ? [v as Node] : []);

/** "lat,lon lat,lon ..." -> closed ring of [lon, lat]. */
export function parseCapPolygon(s: string): [number, number][] {
  const ring = s
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [lat, lon] = pair.split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`invalid CAP polygon point "${pair}"`);
      return [lon!, lat!] as [number, number];
    });
  if (ring.length < 3) throw new Error('CAP polygon needs at least 3 points');
  const [f, l] = [ring[0]!, ring[ring.length - 1]!];
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
  return ring;
}

/** CAP references: space separated "sender,identifier,sent" entries. */
export function parseReferences(s: string | null): CapReference[] {
  if (!s) return [];
  return s
    .trim()
    .split(/\s+/)
    .map((entry) => {
      const [sender = '', identifier = '', sent = ''] = entry.split(',');
      return { sender, identifier, sent };
    })
    .filter((r) => r.identifier);
}

export function parseCap(xml: string): CapAlert {
  const doc = xmlParser.parse(xml) as Node;
  const alert = arr(doc.alert)[0];
  if (!alert) throw new Error('not a CAP document');
  const identifier = text(alert.identifier);
  const sent = text(alert.sent);
  if (!identifier || !sent) throw new Error('CAP alert without identifier or sent');
  return {
    identifier,
    sender: text(alert.sender) ?? '',
    sent,
    status: text(alert.status) ?? 'Actual',
    msgType: text(alert.msgType) ?? 'Alert',
    references: parseReferences(text(alert.references)),
    infos: arr(alert.info).map(parseInfo),
  };
}

function parseInfo(info: Node): CapInfo {
  const parameters: Record<string, string> = {};
  for (const p of arr(info.parameter)) {
    const name = text(p.valueName);
    if (name) parameters[name] = text(p.value) ?? '';
  }
  let eventType: string | null = null;
  for (const c of arr(info.eventCode)) if (text(c.valueName) === 'eventType') eventType = text(c.value);
  return {
    language: text(info.language) ?? 'en-US',
    event: text(info.event) ?? '',
    eventType,
    responseType: arr(info.responseType).map(text).find(Boolean) ?? null,
    severity: text(info.severity),
    certainty: text(info.certainty),
    onset: text(info.onset),
    effective: text(info.effective),
    expires: text(info.expires),
    headline: text(info.headline),
    description: text(info.description),
    instruction: text(info.instruction),
    web: text(info.web),
    awarenessLevel: parameters.awareness_level ?? null,
    parameters,
    areas: arr(info.area).map((a) => ({
      areaDesc: text(a.areaDesc) ?? '',
      polygons: arr(a.polygon).map((p) => parseCapPolygon(text(p) ?? '')),
    })),
  };
}

/** Prefer the Norwegian info block, English as fallback (pipeline stage 2). */
export function pickInfo(alert: CapAlert): { nb: CapInfo | undefined; en: CapInfo | undefined; primary: CapInfo | undefined } {
  const isNo = (l: string) => /^(no|nb|nn)(-|$)/i.test(l);
  const nb = alert.infos.find((i) => isNo(i.language));
  const en = alert.infos.find((i) => /^en(-|$)/i.test(i.language));
  return { nb, en, primary: nb ?? en ?? alert.infos[0] };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface BuildCapInput {
  identifier: string;
  sender?: string;
  sent: string;
  status?: string;
  msgType: 'Alert' | 'Update' | 'Cancel';
  references?: string[]; // "sender,identifier,sent"
  event: string;
  eventType: string;
  responseType?: string;
  severity: string;
  awarenessLevel?: string;
  onset?: string;
  expires: string;
  headline?: string;
  description?: string;
  instruction?: string;
  web?: string;
  areaDesc?: string;
  /** Rings in GeoJSON order [lon, lat]; written as CAP lat,lon. */
  polygons: [number, number][][];
  languages?: ('no' | 'en-GB')[];
}

/** Builds a CAP 1.2 document in MET's profile. Used by simulate-alert and tests. */
export function buildCap(i: BuildCapInput): string {
  const polys = i.polygons.map((ring) => `<polygon>${ring.map(([lon, lat]) => `${lat},${lon}`).join(' ')}</polygon>`).join('');
  const infos = (i.languages ?? ['no', 'en-GB'])
    .map(
      (lang) => `
  <info>
    <language>${lang}</language>
    <category>Met</category>
    <event>${esc(i.event)}</event>
    ${i.responseType ? `<responseType>${i.responseType}</responseType>` : ''}
    <urgency>Future</urgency>
    <severity>${i.severity}</severity>
    <certainty>Likely</certainty>
    <eventCode><valueName>eventType</valueName><value>${esc(i.eventType)}</value></eventCode>
    ${i.onset ? `<onset>${i.onset}</onset>` : ''}
    <expires>${i.expires}</expires>
    <senderName>${lang === 'no' ? 'Meteorologisk Institutt' : 'MET Norway'}</senderName>
    ${i.headline ? `<headline>${esc(i.headline)}</headline>` : ''}
    ${i.description ? `<description>${esc(i.description)}</description>` : ''}
    ${i.instruction ? `<instruction>${esc(i.instruction)}</instruction>` : ''}
    ${i.web ? `<web>${esc(i.web)}</web>` : ''}
    ${i.awarenessLevel ? `<parameter><valueName>awareness_level</valueName><value>${esc(i.awarenessLevel)}</value></parameter>` : ''}
    <area><areaDesc>${esc(i.areaDesc ?? 'Test area')}</areaDesc>${polys}</area>
  </info>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${esc(i.identifier)}</identifier>
  <sender>${esc(i.sender ?? 'noreply@met.no')}</sender>
  <sent>${i.sent}</sent>
  <status>${i.status ?? 'Actual'}</status>
  <msgType>${i.msgType}</msgType>
  <scope>Public</scope>
  ${i.references?.length ? `<references>${esc(i.references.join(' '))}</references>` : ''}${infos}
</alert>`;
}
