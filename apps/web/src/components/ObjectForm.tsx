'use client';
import { useQueryClient } from '@tanstack/react-query';
import {
  refName, SENSITIVITIES, statusesForType, suggestedSituations, type LocationInput, type ObjectGeometry, type ReferenceData, type Sensitivity,
} from '@varsling/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { useHref, useLocale, useT } from '@/lib/i18n';
import { LocationPicker } from './LocationPicker';

function refSets(ref: Pick<ReferenceData, 'situation_types' | 'object_types' | 'object_statuses'>) {
  return {
    situations: ref.situation_types,
    types: ref.object_types,
    statuses: ref.object_statuses,
  };
}

/**
 * Add or edit an object: type (optional), nickname, location, status, situation types
 * (suggested from the type, the customer can untick) and sensitivity per situation type.
 * A member's submission becomes a change proposal.
 */
export interface ExistingObject {
  id: string;
  nickname: string | null;
  type_key: string | null;
  status_key: string;
  place_label: string | null;
  geometry: { type: 'Point' | 'Polygon'; coordinates: unknown } | null;
  situations: { situation_key: string; sensitivity: Sensitivity }[];
}

export function ObjectForm({ reference, existing, asProposal }: { reference: ReferenceData; existing?: ExistingObject; asProposal: boolean }) {
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const router = useRouter();
  const qc = useQueryClient();
  const sets = useMemo(() => refSets(reference), [reference]);
  const [typeKey, setTypeKey] = useState<string | null>(existing?.type_key ?? null);
  const [nickname, setNickname] = useState(existing?.nickname ?? '');
  const [location, setLocation] = useState<LocationInput>(() => {
    const g = existing?.geometry as ObjectGeometry | null | undefined;
    if (!g) return { kind: 'none' };
    return g.type === 'Point' ? { kind: 'point', geometry: g, place_label: existing!.place_label } : { kind: 'area', geometry: g, place_label: existing!.place_label };
  });
  const [statusKey, setStatusKey] = useState('normal');
  const [statusUntil, setStatusUntil] = useState('');
  const initialSituations = existing?.situations.length ? Object.fromEntries(existing.situations.map((s) => [s.situation_key, s.sensitivity])) : null;
  const [custom, setCustom] = useState<Record<string, Sensitivity> | null>(initialSituations);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suggested = suggestedSituations(sets, typeKey, existing?.status_key ?? statusKey);
  const selected: Record<string, Sensitivity> = custom ?? Object.fromEntries(suggested.map((k) => [k, 'high' as Sensitivity]));
  const available = reference.situation_types.filter((s) => s.available);
  const statuses = statusesForType(sets, typeKey);
  const isOther = typeKey && reference.object_types.find((x) => x.key === typeKey)?.defaults.length === 0;

  function toggle(key: string, on: boolean) {
    const next = { ...selected };
    if (on) next[key] = next[key] ?? 'high';
    else delete next[key];
    setCustom(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isOther && Object.keys(selected).length === 0) return setError(t('object.situations.mustChoose'));
    setBusy(true);
    const situations = custom ? Object.entries(custom).map(([situation_key, sensitivity]) => ({ situation_key, sensitivity })) : undefined;
    try {
      if (!existing) {
        const payload = {
          nickname: nickname || null, type_key: typeKey, location, situations,
          ...(statusKey !== 'normal' ? { status_key: statusKey, status_until: new Date(statusUntil).toISOString() } : {}),
        };
        if (asProposal) {
          await unwrap(api.POST('/v1/proposals', { body: { kind: 'object_create', payload } }));
          router.push(href('/proposals'));
        } else {
          const r = await unwrap(api.POST('/v1/objects', { body: payload }));
          await qc.invalidateQueries({ queryKey: ['objects'] });
          router.push(href(`/objects/${r.id}`));
        }
      } else {
        const patch = { nickname: nickname || null, type_key: typeKey, location };
        if (asProposal) {
          await unwrap(api.POST('/v1/proposals', { body: { kind: 'object_update', target_id: existing.id, payload: patch } }));
          if (situations) await unwrap(api.POST('/v1/proposals', { body: { kind: 'object_situations', target_id: existing.id, payload: { situations } } }));
          router.push(href('/proposals'));
        } else {
          await unwrap(api.PATCH('/v1/objects/{id}', { params: { path: { id: existing.id } }, body: patch }));
          await unwrap(api.PUT('/v1/objects/{id}/situations', { params: { path: { id: existing.id } }, body: { situations: situations ?? [] } }));
          await qc.invalidateQueries({ queryKey: ['objects'] });
          router.push(href(`/objects/${existing.id}`));
        }
      }
    } catch (err) {
      setError(t(errorKey(err)));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>1. {t('object.step.type')}</h2>
        <select value={typeKey ?? ''} onChange={(e) => { setTypeKey(e.target.value || null); setCustom(null); }} aria-label={t('object.type')}>
          <option value="">{t('object.type.none')}</option>
          {reference.object_types.map((x) => <option key={x.key} value={x.key}>{refName(x.i18n, locale)}</option>)}
        </select>
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>2. {t('object.step.name')}</h2>
        <label>{t('object.nickname')} ({t('common.optional')})<input value={nickname} maxLength={80} onChange={(e) => setNickname(e.target.value)} /></label>
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>3. {t('object.step.location')}</h2>
        <LocationPicker value={location} onChange={setLocation} maxAreaKm2={reference.config.max_area_km2} />
      </section>
      {!existing && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>4. {t('object.step.status')}</h2>
          <select value={statusKey} onChange={(e) => setStatusKey(e.target.value)} aria-label={t('object.status')}>
            {statuses.map((s) => <option key={s.key} value={s.key}>{refName(reference.object_statuses.find((x) => x.key === s.key)?.i18n, locale)}</option>)}
          </select>
          {statusKey !== 'normal' && <label>{t('object.statusEnd')}<input type="datetime-local" required value={statusUntil} onChange={(e) => setStatusUntil(e.target.value)} /></label>}
        </section>
      )}
      <section className="card stack">
        <h2 style={{ margin: 0 }}>{existing ? 4 : 5}. {t('object.step.situations')}</h2>
        <p className="muted">{t('object.situations.help')}</p>
        <table>
          <tbody>
            {available.map((s) => (
              <tr key={s.key}>
                <td><label className="check"><input type="checkbox" checked={s.key in selected} onChange={(e) => toggle(s.key, e.target.checked)} /> {refName(s.i18n, locale)}</label></td>
                <td>
                  {s.key in selected && (
                    <select value={selected[s.key]} aria-label={t('sensitivity.label')} onChange={(e) => setCustom({ ...selected, [s.key]: e.target.value as Sensitivity })}>
                      {SENSITIVITIES.map((v) => <option key={v} value={v}>{t(`sensitivity.${v}`)} – {t(`sensitivity.${v}.help`)}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>{asProposal ? t('proposals.compose') : t('common.save')}</button>
    </form>
  );
}
