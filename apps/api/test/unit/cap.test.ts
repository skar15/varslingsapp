import { describe, expect, it } from 'vitest';
import levelMap from '../../../../config/level_map.json';
import eventMap from '../../../../config/event_map.json';
import type { LevelMapRow } from '@varsling/shared';
import { chainRootFromReferences, normaliseCap } from '../../src/domain/normalise';
import { parseCap, parseCapPolygon, parseReferences } from '../../src/sources/cap';
import { parseMetRss } from '../../src/sources/met-alerts';
import { parseNveFeed } from '../../src/sources/nve';
import { fixture } from '../helpers/pipeline';

const maps = {
  levelMap: levelMap.rows as LevelMapRow[],
  eventMap: eventMap.rows.map((r) => ({ source: r.source, event: r.event, situation_key: r.situation })),
};

describe('CAP parsing', () => {
  it('swaps CAP lat,lon to lon,lat and closes rings (A13)', () => {
    expect(parseCapPolygon('68.5,16.6 68.5,17.4 68.9,17.4')).toEqual([[16.6, 68.5], [17.4, 68.5], [17.4, 68.9], [16.6, 68.5]]);
  });

  it('parses references', () => {
    expect(parseReferences('a@met.no,2.49.1,2026-11-05T08:00:00+00:00 a@met.no,2.49.2,2026-11-05T09:00:00+00:00').map((r) => r.identifier)).toEqual(['2.49.1', '2.49.2']);
  });

  it('parses a MET fixture and prefers the Norwegian info block', () => {
    const cap = parseCap(fixture('met/wind.xml'));
    expect(cap.msgType).toBe('Alert');
    expect(cap.infos).toHaveLength(2);
    const n = normaliseCap(cap, 'met', maps);
    expect(n.eventKey).toBe('wind');
    expect(n.situationKey).toBe('wind');
    expect(n.level).toBe('yellow');
    expect(n.sourceLevel).toBe('yellow');
    expect(n.titleNb).toContain('Kraftige vindkast');
    expect(n.polygons[0]![0]).toEqual([16.6, 68.5]);
  });

  it.each([
    ['wind', 'wind', 'yellow'], ['gale', 'wind', 'red'], ['rain', 'precipitation', 'yellow'], ['rainFlood', 'flood', 'yellow'],
    ['snow', 'snow', 'yellow'], ['blowingSnow', 'snow', 'yellow'], ['ice', 'ice', 'yellow'], ['icing', 'ice', 'yellow'],
    ['lightning', 'lightning', 'yellow'], ['stormSurge', 'storm_surge', 'red'], ['polarLow', 'wind', 'red'], ['forestFire', 'forest_fire', 'yellow'],
  ])('maps MET %s to %s at %s', (event, situation, level) => {
    const n = normaliseCap(parseCap(fixture(`met/${event}.xml`)), 'met', maps);
    expect(n.situationKey).toBe(situation);
    expect(n.level).toBe(level);
  });

  it('keeps unmapped events with situation null', () => {
    const n = normaliseCap(parseCap(fixture('met/avalanches.xml')), 'met', maps);
    expect(n.situationKey).toBeNull();
    expect(n.eventKey).toBe('avalanches');
  });

  it('maps NVE flood and landslide', () => {
    expect(normaliseCap(parseCap(fixture('nve/flood.xml')), 'nve-flood', maps).situationKey).toBe('flood');
    expect(normaliseCap(parseCap(fixture('nve/landslide.xml')), 'nve-landslide', maps).situationKey).toBe('landslide');
  });

  it('chain root is the earliest referenced identifier', () => {
    expect(chainRootFromReferences('c', [
      { sender: 's', identifier: 'b', sent: '2026-11-05T09:00:00Z' },
      { sender: 's', identifier: 'a', sent: '2026-11-05T08:00:00Z' },
    ])).toBe('a');
    expect(chainRootFromReferences('c', [])).toBe('c');
  });
});

describe('feeds', () => {
  it('reads MET RSS items', () => {
    const items = parseMetRss(fixture('met/current.rss'));
    expect(items).toHaveLength(13);
    expect(items[0]!.url).toContain('cap=2.49.0.1.578.0.20261105080000.001');
  });

  it('reads NVE feeds as JSON ids, Atom entries or inline CAP', () => {
    expect(parseNveFeed(fixture('nve/flood-feed.json'), 'https://nve.test/api')[0]).toEqual({ sourceId: 'nve-flood-20261105-001', url: 'https://nve.test/api/Cap/Id/nve-flood-20261105-001' });
    const atom = '<feed><entry><id>x1</id><link href="https://nve.test/api/Cap/Id/x1"/></entry></feed>';
    expect(parseNveFeed(atom, 'https://nve.test/api')).toEqual([{ sourceId: 'x1', url: 'https://nve.test/api/Cap/Id/x1' }]);
    const inline = `<alerts>${fixture('nve/flood.xml').replace(/<\?xml[^>]*>/, '')}</alerts>`;
    expect(parseNveFeed(inline, 'https://nve.test/api')[0]!.inlineXml).toContain('nve-flood-20261105-001');
  });
});
