import { describe, expect, it } from 'vitest';
import { circleAreaKm2, circleToPolygon, polygonAreaKm2, ringSelfIntersects, validateObjectGeometry, type PolygonGeometry } from '../src/geometry';

const square = (lon: number, lat: number, d: number): PolygonGeometry => ({
  type: 'Polygon',
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
});

describe('geometry', () => {
  it('circle polygon area is close to πr²', () => {
    const poly = circleToPolygon([10.75, 59.91], 10000);
    expect(polygonAreaKm2(poly)).toBeGreaterThan(circleAreaKm2(10000) * 0.98);
    expect(polygonAreaKm2(poly)).toBeLessThan(circleAreaKm2(10000) * 1.01);
  });

  it('enforces the area cap', () => {
    expect(validateObjectGeometry(square(10, 60, 0.1), 2500)).toBeNull();
    expect(validateObjectGeometry(square(10, 60, 1), 2500)).toBe('geo.error.area');
  });

  it('detects self intersection', () => {
    expect(ringSelfIntersects([[10, 60], [11, 61], [11, 60], [10, 61], [10, 60]])).toBe(true);
    expect(validateObjectGeometry({ type: 'Polygon', coordinates: [[[10, 60], [10.1, 60.1], [10.1, 60], [10, 60.1], [10, 60]]] }, 2500)).toBe('geo.error.selfIntersects');
  });

  it('rejects points outside Norway', () => {
    expect(validateObjectGeometry({ type: 'Point', coordinates: [2.35, 48.85] }, 2500)).toBe('geo.error.outsideNorway');
  });
});
