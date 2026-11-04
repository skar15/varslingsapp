import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { View } from 'react-native';
import { TILE_URL } from './config';

type Geo = { type: 'Point'; coordinates: number[] } | { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

const STYLE = {
  version: 8 as const,
  sources: { topo: { type: 'raster' as const, tiles: [TILE_URL], tileSize: 256, attribution: '© Kartverket' } },
  layers: [{ id: 'topo', type: 'raster' as const, source: 'topo' }],
};

function bbox(g: Geo): [number, number, number, number] {
  const pts = (g.type === 'Point' ? [g.coordinates] : g.type === 'Polygon' ? g.coordinates.flat() : g.coordinates.flat(2)) as [number, number][];
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/** MapLibre with Kartverket tiles. Optional press handler for the location picker. */
export function MapPreview({ geometry, draft, onPress, height = 260 }: { geometry?: Geo | null; draft?: number[][]; onPress?: (lonLat: [number, number]) => void; height?: number }) {
  const features: GeoJSON.Feature[] = [];
  if (geometry) features.push({ type: 'Feature', properties: {}, geometry: geometry as GeoJSON.Geometry });
  for (const p of draft ?? []) features.push({ type: 'Feature', properties: { draft: 1 }, geometry: { type: 'Point', coordinates: p } });
  const isPoint = geometry?.type === 'Point';
  return (
    <View style={{ height, borderRadius: 10, overflow: 'hidden' }}>
      <Map mapStyle={STYLE} onPress={(e) => onPress?.([Number(e.nativeEvent.lngLat[0].toFixed(6)), Number(e.nativeEvent.lngLat[1].toFixed(6))])}>
        {geometry ? (
          isPoint ? <Camera center={geometry.coordinates as [number, number]} zoom={11} /> : <Camera bounds={bbox(geometry)} padding={{ top: 30, bottom: 30, left: 30, right: 30 }} />
        ) : (
          <Camera initialViewState={{ center: [15, 65], zoom: 3.5 }} />
        )}
        <GeoJSONSource id="geom" data={{ type: 'FeatureCollection', features }}>
          <Layer id="geom-fill" type="fill" filter={['==', ['geometry-type'], 'Polygon']} style={{ fillColor: '#1d4ed8', fillOpacity: 0.25 }} />
          <Layer id="geom-line" type="line" filter={['==', ['geometry-type'], 'Polygon']} style={{ lineColor: '#1d4ed8', lineWidth: 2 }} />
          <Layer id="geom-point" type="circle" filter={['==', ['geometry-type'], 'Point']} style={{ circleRadius: 7, circleColor: '#1d4ed8', circleStrokeColor: '#fff', circleStrokeWidth: 2 }} />
        </GeoJSONSource>
      </Map>
    </View>
  );
}
