export interface GeoHit {
  label: string;
  kind: 'address' | 'place';
  lat: number;
  lon: number;
  municipality_no: string | null;
}

export interface Geocoder {
  search(q: string): Promise<GeoHit[]>;
  reverse(lat: number, lon: number): Promise<{ label: string | null; municipality_no: string | null; county_no: string | null }>;
  /** County and municipality number for a point (Kartverket kommuneinfo). */
  municipality(lat: number, lon: number): Promise<{ municipality_no: string | null; county_no: string | null }>;
}

/**
 * Kartverket open APIs (ws.geonorge.no). Coordinates are requested in EPSG:4258 (ETRS89),
 * which equals WGS 84 to well under a metre. Free text search with wildcards, no bulk use.
 */
export class KartverketGeocoder implements Geocoder {
  constructor(private readonly base = 'https://ws.geonorge.no', private readonly timeoutMs = 5000) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`kartverket HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async search(q: string): Promise<GeoHit[]> {
    const term = encodeURIComponent(q.trim());
    const [addr, places] = await Promise.allSettled([
      this.get<{ adresser?: { adressetekst: string; poststed?: string; kommunenummer?: string; representasjonspunkt?: { lat: number; lon: number } }[] }>(
        `/adresser/v1/sok?sok=${term}*&treffPerSide=6&utkoordsys=4258`,
      ),
      this.get<{ navn?: { skrivemåte: string; navneobjekttype?: string; kommuner?: { kommunenummer?: string; kommunenavn?: string }[]; representasjonspunkt?: { nord: number; øst: number } }[] }>(
        `/stedsnavn/v1/navn?sok=${term}*&treffPerSide=6&utkoordsys=4258&fuzzy=true`,
      ),
    ]);
    const hits: GeoHit[] = [];
    if (addr.status === 'fulfilled') {
      for (const a of addr.value.adresser ?? []) {
        if (!a.representasjonspunkt) continue;
        hits.push({
          label: [a.adressetekst, a.poststed && titleCase(a.poststed)].filter(Boolean).join(', '),
          kind: 'address', lat: a.representasjonspunkt.lat, lon: a.representasjonspunkt.lon, municipality_no: a.kommunenummer ?? null,
        });
      }
    }
    if (places.status === 'fulfilled') {
      for (const n of places.value.navn ?? []) {
        if (!n.representasjonspunkt) continue;
        const kommune = n.kommuner?.[0];
        hits.push({
          label: [n.skrivemåte, n.navneobjekttype, kommune?.kommunenavn].filter(Boolean).join(', '),
          kind: 'place', lat: n.representasjonspunkt.nord, lon: n.representasjonspunkt.øst, municipality_no: kommune?.kommunenummer ?? null,
        });
      }
    }
    if (addr.status === 'rejected' && places.status === 'rejected') throw addr.reason;
    return hits;
  }

  async reverse(lat: number, lon: number) {
    const r = await this.get<{ adresser?: { adressetekst: string; poststed?: string; kommunenummer?: string }[] }>(
      `/adresser/v1/punktsok?lat=${lat}&lon=${lon}&radius=250&treffPerSide=1&koordsys=4258&utkoordsys=4258`,
    );
    const a = r.adresser?.[0];
    const m = await this.municipality(lat, lon).catch(() => ({ municipality_no: a?.kommunenummer ?? null, county_no: null }));
    return { label: a ? [a.adressetekst, a.poststed && titleCase(a.poststed)].filter(Boolean).join(', ') : null, ...m };
  }

  async municipality(lat: number, lon: number) {
    const r = await this.get<{ kommunenummer?: string; fylkesnummer?: string }>(`/kommuneinfo/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258`);
    return { municipality_no: r.kommunenummer ?? null, county_no: r.fylkesnummer ?? null };
  }
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
}

export class FakeGeocoder implements Geocoder {
  places: GeoHit[] = [
    { label: 'Stræte, Grovfjord, Tjeldsund', kind: 'place', lat: 68.6806, lon: 16.9946, municipality_no: '5512' },
    { label: 'Andenes, Andøy', kind: 'place', lat: 69.3143, lon: 16.1194, municipality_no: '1871' },
  ];
  async search(q: string) {
    return this.places.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()));
  }
  async reverse(_lat: number, _lon: number) {
    return { label: null, municipality_no: null, county_no: null };
  }
  async municipality(lat: number, _lon: number) {
    return lat > 68 ? { municipality_no: '5512', county_no: '55' } : { municipality_no: '0301', county_no: '03' };
  }
}
