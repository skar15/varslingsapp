/** Geometry helpers shared by the API validators and the map pickers. GeoJSON order: [lon, lat]. */

export type Position = [number, number];
export interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}
export type ObjectGeometry = PointGeometry | PolygonGeometry;

const EARTH_RADIUS_M = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Max corners a customer may draw by hand (spec: polygon of up to 20 corners). */
export const MAX_DRAWN_CORNERS = 20;
/** Max vertices the API accepts in one ring (a circle is approximated by 48 corners). */
export const MAX_RING_VERTICES = 64;
export const CIRCLE_SEGMENTS = 48;

/** Area of a single ring in km² on a sphere (Chamberlain & Duquette 2007). */
export function ringAreaKm2(ring: Position[]): number {
  const pts = closeRing(ring);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [lon1, lat1] = pts[i]!;
    const [lon2, lat2] = pts[i + 1]!;
    total += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M ** 2) / 2) / 1e6;
}

export function polygonAreaKm2(poly: PolygonGeometry): number {
  const [outer, ...holes] = poly.coordinates;
  if (!outer) return 0;
  return ringAreaKm2(outer) - holes.reduce((s, h) => s + ringAreaKm2(h), 0);
}

export function closeRing(ring: Position[]): Position[] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/** Destination point given start, bearing (deg) and distance (m) on a sphere. */
export function destination(center: Position, bearingDeg: number, distanceM: number): Position {
  const [lon, lat] = center;
  const d = distanceM / EARTH_RADIUS_M;
  const b = rad(bearingDeg);
  const phi1 = rad(lat);
  const lam1 = rad(lon);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(b));
  const lam2 = lam1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(phi1), Math.cos(d) - Math.sin(phi1) * Math.sin(phi2));
  return [round6((lam2 * 180) / Math.PI), round6((phi2 * 180) / Math.PI)];
}

export function circleToPolygon(center: Position, radiusM: number, segments = CIRCLE_SEGMENTS): PolygonGeometry {
  const ring: Position[] = [];
  for (let i = 0; i < segments; i++) ring.push(destination(center, (360 / segments) * i, radiusM));
  return { type: 'Polygon', coordinates: [closeRing(ring)] };
}

export function circleAreaKm2(radiusM: number): number {
  return (Math.PI * radiusM ** 2) / 1e6;
}

export function centroid(geom: ObjectGeometry): Position {
  if (geom.type === 'Point') return geom.coordinates;
  const ring = geom.coordinates[0] ?? [];
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  const lon = pts.reduce((s, p) => s + p[0], 0) / Math.max(pts.length, 1);
  const lat = pts.reduce((s, p) => s + p[1], 0) / Math.max(pts.length, 1);
  return [round6(lon), round6(lat)];
}

/** Simple self-intersection check for a ring (O(n²), fine for ≤ 64 vertices). */
export function ringSelfIntersects(ring: Position[]): boolean {
  const pts = closeRing(ring);
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!)) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1: Position, p2: Position, p3: Position, p4: Position): boolean {
  const d = (a: Position, b: Position, c: Position) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export type GeometryError = 'geo.error.vertices' | 'geo.error.selfIntersects' | 'geo.error.area' | 'geo.error.outsideNorway';

export function validateObjectGeometry(geom: ObjectGeometry, maxAreaKm2: number): GeometryError | null {
  const inNorway = ([lon, lat]: Position) => lat >= 57 && lat <= 81.5 && lon >= -9.5 && lon <= 34;
  if (geom.type === 'Point') return inNorway(geom.coordinates) ? null : 'geo.error.outsideNorway';
  const ring = geom.coordinates[0];
  if (!ring || geom.coordinates.length !== 1) return 'geo.error.vertices';
  const closed = closeRing(ring);
  if (closed.length < 4 || closed.length > MAX_RING_VERTICES + 1) return 'geo.error.vertices';
  if (!closed.every(inNorway)) return 'geo.error.outsideNorway';
  if (ringSelfIntersects(closed)) return 'geo.error.selfIntersects';
  if (polygonAreaKm2({ type: 'Polygon', coordinates: [closed] }) > maxAreaKm2) return 'geo.error.area';
  return null;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
