'use client';
import {
  circleAreaKm2, circleToPolygon, closeRing, MAX_DRAWN_CORNERS, parseCoordinates, polygonAreaKm2, validateObjectGeometry,
  type LocationInput, type Position,
} from '@varsling/shared';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { MapView } from './MapView';

type Tab = 'search' | 'coordinates' | 'map';
type MapMode = 'point' | 'polygon' | 'circle';

/**
 * Location picker with three tabs: search (Kartverket through the API), coordinates (parsed
 * live with a preview), and map (pin, polygon up to 20 corners, or circle) with the area
 * shown against the cap. The area mode lets a customer avoid giving an exact address.
 */
export function LocationPicker({ value, onChange, maxAreaKm2 }: { value: LocationInput; onChange: (v: LocationInput) => void; maxAreaKm2: number }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('search');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [coordText, setCoordText] = useState('');
  const [mode, setMode] = useState<MapMode>('point');
  const [corners, setCorners] = useState<Position[]>([]);
  const [center, setCenter] = useState<Position | null>(null);
  const [radiusKm, setRadiusKm] = useState(2);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const h = setTimeout(async () => {
      try {
        const r = await unwrap(api.GET('/v1/geo/search', { params: { query: { q } } }));
        setHits(r.items);
      } catch {
        setHits([]);
      }
    }, 300);
    return () => clearTimeout(h);
  }, [q]);

  const parsed = coordText ? parseCoordinates(coordText) : null;
  const geometry = value.kind === 'none' ? null : value.geometry;
  const area = value.kind === 'area' ? polygonAreaKm2(value.geometry) : null;
  const geoError = value.kind === 'none' ? null : validateObjectGeometry(value.geometry, maxAreaKm2);

  const setPoint = (p: Position, label?: string | null) => onChange({ kind: 'point', geometry: { type: 'Point', coordinates: p }, place_label: label ?? null });

  function mapClick(p: Position) {
    if (mode === 'point') setPoint(p);
    else if (mode === 'polygon') {
      if (corners.length >= MAX_DRAWN_CORNERS) return;
      const next = [...corners, p];
      setCorners(next);
      if (next.length >= 3) onChange({ kind: 'area', geometry: { type: 'Polygon', coordinates: [closeRing(next)] }, place_label: null });
    } else {
      setCenter(p);
      onChange({ kind: 'area', geometry: circleToPolygon(p, radiusKm * 1000), place_label: null });
    }
  }


  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {(['search', 'coordinates', 'map'] as const).map((k) => (
          <button type="button" key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(`location.tab.${k}`)}</button>
        ))}
      </div>
      {tab === 'search' && (
        <div className="stack">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('location.search.placeholder')} aria-label={t('location.tab.search')} />
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {hits.map((h) => (
              <li key={`${h.label}${h.lat}`}>
                <button type="button" className="btn" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 4 }} onClick={() => setPoint([h.lon, h.lat], h.label)}>{h.label}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === 'coordinates' && (
        <div className="stack">
          <input value={coordText} onChange={(e) => setCoordText(e.target.value)} placeholder={t('location.coords.placeholder')} aria-label={t('location.tab.coordinates')} />
          {parsed && (parsed.ok ? (
            <div className="row">
              <span>{t('location.coords.parsed', { lat: parsed.lat.toFixed(5), lon: parsed.lon.toFixed(5), format: t(`coord.format.${parsed.format}`) })}</span>
              {parsed.swapped && <span className="muted">{t('location.coords.swapped')}</span>}
              <button type="button" className="btn btn-primary" onClick={() => setPoint([parsed.lon, parsed.lat])}>{t('common.confirm')}</button>
            </div>
          ) : <span className="error">{t(parsed.error)}</span>)}
        </div>
      )}
      {tab === 'map' && (
        <div className="row">
          {(['point', 'polygon', 'circle'] as const).map((m) => (
            <label className="check" key={m}><input type="radio" name="mapmode" checked={mode === m} onChange={() => { setMode(m); setCorners([]); setCenter(null); }} /> {t(`location.map.${m}`)}</label>
          ))}
          {mode === 'polygon' && <span className="muted">{t('location.map.corners', { n: corners.length, max: MAX_DRAWN_CORNERS })}</span>}
          {mode === 'circle' && (
            <label style={{ flexDirection: 'row', alignItems: 'center' }}>{t('location.map.radius')}
              <input type="number" min={0.1} max={28} step={0.1} value={radiusKm} onChange={(e) => {
                const km = Number(e.target.value);
                setRadiusKm(km);
                if (center && km > 0) onChange({ kind: 'area', geometry: circleToPolygon(center, km * 1000), place_label: null });
              }} style={{ width: 90 }} />
            </label>
          )}
          <button type="button" className="btn" onClick={() => { setCorners([]); setCenter(null); onChange({ kind: 'none' }); }}>{t('location.map.clear')}</button>
        </div>
      )}
      <div className="map">
        <MapView geometry={geometry} draft={tab === 'map' && mode === 'polygon' && corners.length < 3 ? corners : undefined} onClick={tab === 'map' ? mapClick : undefined} />
      </div>
      {mode === 'polygon' && tab === 'map' && <p className="muted">{t('location.areaHelp')}</p>}
      {area !== null && (
        <p className={area > maxAreaKm2 ? 'error' : 'muted'}>
          {t('location.map.area', { area: area.toFixed(1), max: maxAreaKm2 })}
          {mode === 'circle' && center ? ` (≈ ${circleAreaKm2(radiusKm * 1000).toFixed(1)} km²)` : ''}
        </p>
      )}
      {geoError && <p className="error">{t(geoError)}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setPoint([Number(p.coords.longitude.toFixed(5)), Number(p.coords.latitude.toFixed(5))]))}>
          {t('location.useMyPosition')}
        </button>
        <button type="button" className="btn" onClick={() => onChange({ kind: 'none' })}>{t('location.none')}</button>
        {value.kind === 'none' && <span className="banner">{t('object.noLocation')}</span>}
        {value.kind !== 'none' && value.place_label && <span className="muted">{value.place_label}</span>}
      </div>
    </div>
  );
}
