'use client';
import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { TILE_URL } from '@/lib/env';

type Geo = { type: 'Point'; coordinates: number[] } | { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

function bounds(g: Geo): [[number, number], [number, number]] {
  const pts = (g.type === 'Point' ? [g.coordinates] : g.type === 'Polygon' ? g.coordinates.flat() : g.coordinates.flat(2)) as [number, number][];
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

/** MapLibre with Kartverket tiles. Shows a geometry and optionally reports clicks. */
export function MapView({ geometry, draft, onClick }: { geometry?: Geo | null; draft?: [number, number][]; onClick?: (lonLat: [number, number]) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then((maplibregl) => {
      if (cancelled || !el.current) return;
      const m = new maplibregl.Map({
        container: el.current,
        style: {
          version: 8,
          sources: { topo: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: '© Kartverket' } },
          layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
        },
        center: [15, 65],
        zoom: 3.5,
      });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }));
      m.on('click', (e: MapMouseEvent) => clickRef.current?.([Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]));
      m.on('load', () => {
        m.addSource('geom', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'geom-fill', type: 'fill', source: 'geom', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'fill-color': '#1d4ed8', 'fill-opacity': 0.2 } });
        m.addLayer({ id: 'geom-line', type: 'line', source: 'geom', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#1d4ed8', 'line-width': 2 } });
        m.addLayer({ id: 'geom-point', type: 'circle', source: 'geom', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 8, 'circle-color': '#1d4ed8', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        m.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#d92d20', 'line-width': 2, 'line-dasharray': [2, 1] } });
        m.addLayer({ id: 'draft-pt', type: 'circle', source: 'draft', paint: { 'circle-radius': 5, 'circle-color': '#d92d20' } });
        map.current = m;
      });
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const apply = () => {
      const m = map.current;
      if (!m) return;
      const src = m.getSource('geom') as unknown as { setData: (d: unknown) => void } | undefined;
      src?.setData({ type: 'FeatureCollection', features: geometry ? [{ type: 'Feature', properties: {}, geometry }] : [] });
      const d = m.getSource('draft') as unknown as { setData: (d: unknown) => void } | undefined;
      const features: unknown[] = (draft ?? []).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
      if (draft && draft.length > 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draft } });
      d?.setData({ type: 'FeatureCollection', features });
      if (geometry) {
        const b = bounds(geometry);
        if (geometry.type === 'Point') m.easeTo({ center: geometry.coordinates as [number, number], zoom: Math.max(m.getZoom(), 11) });
        else m.fitBounds(b, { padding: 40, maxZoom: 12 });
      }
    };
    if (map.current) apply();
    const timer = setInterval(() => {
      if (map.current) {
        apply();
        clearInterval(timer);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [geometry, draft]);

  return <div ref={el} style={{ width: '100%', height: '100%' }} />;
}
