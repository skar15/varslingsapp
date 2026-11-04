import { circleToPolygon, closeRing, MAX_DRAWN_CORNERS, parseCoordinates, polygonAreaKm2, validateObjectGeometry, type LocationInput, type Position } from '@varsling/shared';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, unwrap } from './api';
import { useT } from './i18n';
import { MapPreview } from './MapPreview';
import { Banner, Button, Chip, Field, styles, T } from './ui';

/** Search, coordinates (parsed live), or map: pin, polygon (≤ 20 corners) or circle. */
export function LocationPicker({ value, onChange, maxAreaKm2 }: { value: LocationInput; onChange: (v: LocationInput) => void; maxAreaKm2: number }) {
  const t = useT();
  const [tab, setTab] = useState<'search' | 'coordinates' | 'map'>('search');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [coordText, setCoordText] = useState('');
  const [mode, setMode] = useState<'point' | 'polygon' | 'circle'>('point');
  const [corners, setCorners] = useState<Position[]>([]);
  const [center, setCenter] = useState<Position | null>(null);
  const [radiusKm, setRadiusKm] = useState('2');

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const h = setTimeout(() => {
      unwrap(api.GET('/v1/geo/search', { params: { query: { q } } })).then((r) => setHits(r.items)).catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q]);

  const setPoint = (p: Position, label?: string | null) => onChange({ kind: 'point', geometry: { type: 'Point', coordinates: p }, place_label: label ?? null });
  const parsed = coordText ? parseCoordinates(coordText) : null;
  const geoError = value.kind === 'none' ? null : validateObjectGeometry(value.geometry, maxAreaKm2);

  function press(p: Position) {
    if (tab !== 'map') return;
    if (mode === 'point') setPoint(p);
    else if (mode === 'polygon') {
      if (corners.length >= MAX_DRAWN_CORNERS) return;
      const next = [...corners, p];
      setCorners(next);
      if (next.length >= 3) onChange({ kind: 'area', geometry: { type: 'Polygon', coordinates: [closeRing(next)] }, place_label: null });
    } else {
      setCenter(p);
      onChange({ kind: 'area', geometry: circleToPolygon(p, Number(radiusKm) * 1000), place_label: null });
    }
  }

  /** Device location: foreground only, used once, never stored as the phone's position. */
  async function useMyPosition() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setPoint([Number(pos.coords.longitude.toFixed(5)), Number(pos.coords.latitude.toFixed(5))]);
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.row}>
        {(['search', 'coordinates', 'map'] as const).map((k) => <Chip key={k} label={t(`location.tab.${k}`)} selected={tab === k} onPress={() => setTab(k)} />)}
      </View>
      {tab === 'search' && (
        <>
          <Field label={t('location.tab.search')} value={q} onChangeText={setQ} placeholder={t('location.search.placeholder')} />
          {hits.map((h) => <Button key={`${h.label}${h.lat}`} title={h.label} onPress={() => setPoint([h.lon, h.lat], h.label)} />)}
        </>
      )}
      {tab === 'coordinates' && (
        <>
          <Field label={t('location.tab.coordinates')} value={coordText} onChangeText={setCoordText} placeholder={t('location.coords.placeholder')} autoCapitalize="characters" />
          {parsed && (parsed.ok ? (
            <>
              <T>{t('location.coords.parsed', { lat: parsed.lat.toFixed(5), lon: parsed.lon.toFixed(5), format: t(`coord.format.${parsed.format}`) })}</T>
              {parsed.swapped && <T muted>{t('location.coords.swapped')}</T>}
              <Button kind="primary" title={t('common.confirm')} onPress={() => setPoint([parsed.lon, parsed.lat])} />
            </>
          ) : <T color="#b42318">{t(parsed.error)}</T>)}
        </>
      )}
      {tab === 'map' && (
        <View style={styles.row}>
          {(['point', 'polygon', 'circle'] as const).map((m) => <Chip key={m} label={t(`location.map.${m}`)} selected={mode === m} onPress={() => { setMode(m); setCorners([]); setCenter(null); }} />)}
          {mode === 'polygon' && <T muted>{t('location.map.corners', { n: corners.length, max: MAX_DRAWN_CORNERS })}</T>}
          {mode === 'circle' && (
            <Field label={t('location.map.radius')} value={radiusKm} keyboardType="decimal-pad" onChangeText={(v) => {
              setRadiusKm(v);
              const km = Number(v.replace(',', '.'));
              if (center && km > 0) onChange({ kind: 'area', geometry: circleToPolygon(center, km * 1000), place_label: null });
            }} />
          )}
        </View>
      )}
      <MapPreview geometry={value.kind === 'none' ? null : value.geometry} draft={tab === 'map' && mode === 'polygon' && corners.length < 3 ? corners : undefined} onPress={press} />
      {value.kind === 'area' && <T muted>{t('location.map.area', { area: polygonAreaKm2(value.geometry).toFixed(1), max: maxAreaKm2 })}</T>}
      {geoError && <T color="#b42318">{t(geoError)}</T>}
      {value.kind === 'none' && <Banner>{t('object.noLocation')}</Banner>}
      <View style={styles.row}>
        <Button title={t('location.useMyPosition')} onPress={() => void useMyPosition()} />
        <Button title={t('location.none')} onPress={() => onChange({ kind: 'none' })} />
        <Button title={t('location.map.clear')} onPress={() => { setCorners([]); setCenter(null); }} />
      </View>
    </View>
  );
}
