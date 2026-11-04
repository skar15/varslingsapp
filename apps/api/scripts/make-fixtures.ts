/**
 * Generates the CAP fixtures in test/fixtures. They follow MET's CAP v2 profile and are
 * SYNTHETIC: this environment could not reach api.met.no or api01.nve.no. Replace them with
 * real files from MET's `example` feed and real NVE payloads (rule 5; docs/decisions/006).
 * Usage: tsx scripts/make-fixtures.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCap } from '../src/sources/cap';

const dir = path.join(import.meta.dirname, '..', 'test', 'fixtures');
// Grovfjord / Tjeldsund area, given as GeoJSON [lon, lat]; buildCap writes CAP lat,lon.
const TROMS: [number, number][] = [[16.6, 68.5], [17.4, 68.5], [17.4, 68.9], [16.6, 68.9], [16.6, 68.5]];

const MET_EVENTS: { eventType: string; nb: string; awareness: string }[] = [
  { eventType: 'wind', nb: 'Kraftige vindkast', awareness: '2; yellow; Moderate' },
  { eventType: 'gale', nb: 'Storm', awareness: '3; orange; Severe' },
  { eventType: 'rain', nb: 'Mye regn', awareness: '2; yellow; Moderate' },
  { eventType: 'rainFlood', nb: 'Regnflom', awareness: '2; yellow; Moderate' },
  { eventType: 'snow', nb: 'Snø', awareness: '2; yellow; Moderate' },
  { eventType: 'blowingSnow', nb: 'Snøfokk', awareness: '2; yellow; Moderate' },
  { eventType: 'ice', nb: 'Glatte veier', awareness: '2; yellow; Moderate' },
  { eventType: 'icing', nb: 'Ising', awareness: '2; yellow; Moderate' },
  { eventType: 'lightning', nb: 'Torden', awareness: '2; yellow; Moderate' },
  { eventType: 'stormSurge', nb: 'Stormflo', awareness: '3; orange; Severe' },
  { eventType: 'polarLow', nb: 'Polart lavtrykk', awareness: '3; orange; Severe' },
  { eventType: 'forestFire', nb: 'Skogbrannfare', awareness: '2; yellow; Moderate' },
  { eventType: 'avalanches', nb: 'Snøskredfare', awareness: '3; orange; Severe' },
];

await mkdir(path.join(dir, 'met'), { recursive: true });
await mkdir(path.join(dir, 'nve'), { recursive: true });

const items: string[] = [];
for (const [i, e] of MET_EVENTS.entries()) {
  const identifier = `2.49.0.1.578.0.20261105080000.${String(i + 1).padStart(3, '0')}`;
  const severity = e.awareness.includes('orange') ? 'Severe' : 'Moderate';
  const xml = buildCap({
    identifier, sent: '2026-11-05T08:00:00+00:00', msgType: 'Alert', event: e.nb, eventType: e.eventType, responseType: 'Monitor', severity,
    awarenessLevel: e.awareness, onset: '2026-11-05T12:00:00+00:00', expires: '2026-11-06T00:00:00+00:00',
    headline: `${e.nb}, ${e.awareness.split('; ')[1] === 'yellow' ? 'gult' : 'oransje'} nivå, Sør-Troms`,
    description: `${e.nb} ventes i Sør-Troms.`, instruction: 'Følg med på oppdaterte varsler.',
    web: 'https://www.met.no/vaer-og-klima/ekstremvaervarsler-og-andre-farevarsler', areaDesc: 'Sør-Troms', polygons: [TROMS],
  });
  const file = `${e.eventType}.xml`;
  await writeFile(path.join(dir, 'met', file), xml);
  items.push(`    <item>
      <title>${e.nb}</title>
      <link>https://api.met.no/weatherapi/metalerts/2.0/current?cap=${identifier}</link>
      <guid isPermaLink="false">${identifier}</guid>
      <pubDate>Thu, 05 Nov 2026 08:00:00 +0000</pubDate>
    </item>`);
}
await writeFile(
  path.join(dir, 'met', 'current.rss'),
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>MetAlerts</title>
    <link>https://api.met.no/weatherapi/metalerts/2.0/current.rss</link>
${items.join('\n')}
  </channel>
</rss>
`,
);

for (const [source, event, nb] of [['flood', 'flood', 'Flomfare'], ['landslide', 'landslide', 'Jordskredfare']] as const) {
  const identifier = `nve-${source}-20261105-001`;
  const xml = buildCap({
    identifier, sender: 'post@nve.no', sent: '2026-11-05T06:00:00+00:00', msgType: 'Alert', event: nb, eventType: event, responseType: 'Prepare',
    severity: 'Moderate', awarenessLevel: '2; yellow; Moderate', onset: '2026-11-05T07:00:00+00:00', expires: '2026-11-06T07:00:00+00:00',
    headline: `${nb}, gult nivå`, description: `${nb} i Sør-Troms.`, web: 'https://www.varsom.no', areaDesc: 'Sør-Troms', polygons: [TROMS], languages: ['no'],
  });
  await writeFile(path.join(dir, 'nve', `${source}.xml`), xml);
  await writeFile(path.join(dir, 'nve', `${source}-feed.json`), `${JSON.stringify([{ Id: identifier }], null, 2)}\n`);
}
process.stdout.write('fixtures written\n');
