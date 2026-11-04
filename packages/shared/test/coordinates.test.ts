import { describe, expect, it } from 'vitest';
import { latLonToUtm, parseCoordinates, utmToLatLon } from '../src/coordinates';

const ok = (input: string) => {
  const r = parseCoordinates(input);
  if (!r.ok) throw new Error(`${input} -> ${r.error}`);
  return r;
};

describe('decimal degrees', () => {
  it.each([
    ['69.3143, 16.1194'],
    ['69.3143 16.1194'],
    ['69,3143 16,1194'],
    ['69.3143N 16.1194E'],
    ['N69.3143 E16.1194'],
    ['N 69.3143, Ø 16.1194'],
    ['69.3143° N, 16.1194° Ø'],
    ['lat 69.3143 lon 16.1194'],
    ['16.1194E 69.3143N'],
  ])('%s', (input) => {
    const r = ok(input);
    expect(r.format).toBe('dd');
    expect(r.lat).toBeCloseTo(69.3143, 6);
    expect(r.lon).toBeCloseTo(16.1194, 6);
  });

  it('swaps a reversed pair without hemisphere letters and reports it', () => {
    const r = ok('16.1194, 69.3143');
    expect(r.lat).toBeCloseTo(69.3143);
    expect(r.swapped).toBe(true);
  });

  it('accepts west longitude (Jan Mayen) with V and W', () => {
    expect(ok('70.98N 8.5V').lon).toBeCloseTo(-8.5);
    expect(ok('70.98N 8.5W').lon).toBeCloseTo(-8.5);
  });
});

describe('degrees and decimal minutes', () => {
  it.each([["69° 18.858' N, 16° 7.164' E"], ["N 69 18.858 E 16 7.164"], ["69°18,858'N 16°07,164'Ø"], ['69 18.858 16 7.164']])('%s', (input) => {
    const r = ok(input);
    expect(r.format).toBe('dm');
    expect(r.lat).toBeCloseTo(69.3143, 4);
    expect(r.lon).toBeCloseTo(16.1194, 4);
  });
});

describe('degrees minutes seconds', () => {
  it.each([[`69°18'51.5"N 16°07'09.8"E`], [`N 69° 18′ 51.5″ E 16° 7′ 9.8″`], [`69 18 51.5 16 7 9.8`], [`69°18'51.5" 16°7'9.8"`]])('%s', (input) => {
    const r = ok(input);
    expect(r.format).toBe('dms');
    expect(r.lat).toBeCloseTo(69.314306, 5);
    expect(r.lon).toBeCloseTo(16.119389, 5);
  });

  it('rejects minutes >= 60', () => {
    expect(parseCoordinates(`69°61'0"N 16°7'9"E`).ok).toBe(false);
  });
});

describe('UTM (ETRS89)', () => {
  it('central meridian at 60N in zone 32 gives the textbook northing', () => {
    const { easting, northing } = latLonToUtm(60, 9, 32);
    expect(easting).toBeCloseTo(500000, 3);
    expect(northing).toBeCloseTo(6651411.19, 0);
  });

  it.each([
    [32, 59.9115, 10.734],
    [33, 69.3143, 16.1194],
    [35, 70.0745, 29.7487],
  ])('round trips zone %i', (zone, lat, lon) => {
    const { easting, northing } = latLonToUtm(lat, lon, zone);
    const back = utmToLatLon(zone, easting, northing);
    expect(back.lat).toBeCloseTo(lat, 7);
    expect(back.lon).toBeCloseTo(lon, 7);
  });

  it.each([
    ['33W {E} {N}'],
    ['UTM 33 {E} {N}'],
    ['sone 33 Ø {E} N {N}'],
    ['33 N {N} Ø {E}'],
    ['Zone 33 {E}, {N}'],
  ])('%s', (template) => {
    const { easting, northing } = latLonToUtm(69.3143, 16.1194, 33);
    const input = template.replace('{E}', easting.toFixed(1)).replace('{N}', northing.toFixed(1));
    const r = ok(input);
    expect(r.format).toBe('utm');
    expect(r.zone).toBe(33);
    expect(r.lat).toBeCloseTo(69.3143, 5);
    expect(r.lon).toBeCloseTo(16.1194, 5);
  });

  it('parses zone 32 and 35', () => {
    const z32 = latLonToUtm(59.9115, 10.734, 32);
    expect(ok(`32V ${Math.round(z32.easting)} ${Math.round(z32.northing)}`).lat).toBeCloseTo(59.9115, 4);
    const z35 = latLonToUtm(70.0745, 29.7487, 35);
    expect(ok(`35W ${Math.round(z35.easting)} ${Math.round(z35.northing)}`).lon).toBeCloseTo(29.7487, 4);
  });

  it('rejects other zones', () => {
    expect(parseCoordinates('34W 500000 7700000')).toEqual({ ok: false, error: 'coord.error.utmZone' });
  });
});

describe('errors', () => {
  it.each([
    ['', 'coord.error.empty'],
    ['hello', 'coord.error.unrecognised'],
    ['69.3', 'coord.error.unrecognised'],
    ['48.85, 2.35', 'coord.error.outsideNorway'],
    ['69.3N 16.1N', 'coord.error.unrecognised'],
  ])('%s -> %s', (input, error) => {
    expect(parseCoordinates(input)).toEqual({ ok: false, error });
  });
});
