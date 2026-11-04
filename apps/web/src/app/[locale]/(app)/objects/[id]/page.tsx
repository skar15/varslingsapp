'use client';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatPeriod, refName, statusesForType } from '@varsling/shared';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Light } from '@/components/Light';
import { MapView } from '@/components/MapView';
import { api, unwrap } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { useHref, useLocale, useT } from '@/lib/i18n';
import { useObject, useReference } from '@/lib/queries';

function inHours(h: number): string {
  const d = new Date(Date.now() + h * 3_600_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function ObjectDetail() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const router = useRouter();
  const qc = useQueryClient();
  const obj = useObject(id);
  const ref = useReference();
  const [status, setStatus] = useState('');
  const [until, setUntil] = useState(inHours(2));
  const [extendHours, setExtendHours] = useState(2);
  const [error, setError] = useState<string | null>(null);

  if (!obj.data || !ref.data) return <main><p>{obj.isError ? t('common.error') : t('common.loading')}</p></main>;
  const o = obj.data;
  const r = ref.data;
  const sets = { situations: r.situation_types, types: r.object_types, statuses: r.object_statuses };
  const name = (list: { key: string; i18n: { nb: string; en?: string } }[], k: string | null) => refName(list.find((x) => x.key === k)?.i18n, locale);
  const temp = o.status_key !== o.normal_status_key;
  const refresh = () => qc.invalidateQueries({ queryKey: ['objects'] });
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(t(errorKey(err)));
    }
  };

  return (
    <main className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{o.display_name}</h1>
        <div className="row">
          <a className="btn" href={href(`/objects/${o.id}/edit`)}>{o.can_edit ? t('common.edit') : t('proposals.compose')}</a>
          {o.can_delete && (
            <button className="btn btn-danger" onClick={() => {
              if (!window.confirm(t('object.delete.confirm', { name: o.display_name }))) return;
              void run(async () => {
                await unwrap(api.DELETE('/v1/objects/{id}', { params: { path: { id } } }));
                router.push(href('/dashboard'));
              });
            }}>{t('common.delete')}</button>
          )}
        </div>
      </div>
      <Light level={o.light} />
      {o.location_kind === 'none' && <p className="banner">{t('object.noLocation')} – {t('object.noLocation.help')}</p>}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>{t('object.activeAlerts')}</h2>
        {o.alerts.length === 0 && <p className="muted">{t('dashboard.noAlerts')}</p>}
        {o.alerts.map((a) => (
          <a key={a.id} href={href(`/alerts/${a.id}`)} className="row">
            <Light level={a.level ?? 'none'} compact /> {name(r.situation_types, a.situation_key)} · {formatPeriod(a.onset, a.expires, locale)} · {a.title}
          </a>
        ))}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>{t('object.status')}</h2>
        <div className="row">
          <span className="badge">{name(r.object_statuses, o.status_key)}</span>
          {o.status_until && <span>{t('object.statusUntil', { time: formatDateTime(o.status_until, locale) })}</span>}
          {o.status_set_by && <span className="muted">{t('object.statusSetBy', { name: o.status_set_by.name })}</span>}
        </div>
        {temp && (
          <div className="row" style={search?.get('extend') ? { outline: '2px solid var(--primary)', padding: 8, borderRadius: 8 } : undefined}>
            <label style={{ flexDirection: 'row', alignItems: 'center' }}>{t('object.extendBy')}
              <select value={extendHours} onChange={(e) => setExtendHours(Number(e.target.value))} style={{ width: 120 }}>
                {[1, 2, 4, 8, 24, 48].map((h) => <option key={h} value={h}>{t('object.hours', { n: h })}</option>)}
              </select>
            </label>
            <button className="btn" onClick={() => run(() => unwrap(api.POST('/v1/objects/{id}/status/extend', {
              params: { path: { id } }, body: { until: new Date(Math.max(Date.now(), Date.parse(o.status_until ?? '')) + extendHours * 3_600_000).toISOString() },
            })))}>{t('object.extendStatus')}</button>
            <button className="btn" onClick={() => run(() => unwrap(api.PUT('/v1/objects/{id}/status', { params: { path: { id } }, body: { status_key: o.normal_status_key } })))}>
              {name(r.object_statuses, o.normal_status_key)}
            </button>
          </div>
        )}
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          if (!status) return;
          void run(() => unwrap(api.PUT('/v1/objects/{id}/status', { params: { path: { id } }, body: { status_key: status, ...(status !== o.normal_status_key ? { until: new Date(until).toISOString() } : {}) } })));
        }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('object.setStatus')} style={{ width: 'auto' }}>
            <option value="">{t('object.setStatus')}</option>
            {statusesForType(sets, o.type_key).filter((s) => s.key !== o.status_key).map((s) => <option key={s.key} value={s.key}>{name(r.object_statuses, s.key)}</option>)}
          </select>
          {status && status !== o.normal_status_key && (
            <label style={{ flexDirection: 'row', alignItems: 'center' }}>{t('object.statusEnd')}
              <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} required style={{ width: 'auto' }} />
            </label>
          )}
          <button className="btn btn-primary" type="submit" disabled={!status}>{t('common.save')}</button>
        </form>
        {o.can_set_normal && (
          <label style={{ maxWidth: 360 }}>{t('object.normalStatus')}
            <select value={o.normal_status_key} onChange={(e) => run(() => unwrap(api.PUT('/v1/objects/{id}/normal-status', { params: { path: { id } }, body: { status_key: e.target.value } })))}>
              {statusesForType(sets, o.type_key).map((s) => <option key={s.key} value={s.key}>{name(r.object_statuses, s.key)}</option>)}
            </select>
          </label>
        )}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>{t('object.situations')}</h2>
        <table>
          <tbody>
            {o.monitored.map((m) => (
              <tr key={m.key}>
                <td>{name(r.situation_types, m.key)}</td>
                <td>{t('sensitivity.label')}: {t(`sensitivity.${m.effective_sensitivity}`)}</td>
                <td>{m.added_by_status && <span className="badge">{t('object.situations.addedByStatus')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {o.geometry && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>{t('object.location')}</h2>
          {o.place_label && <p className="muted">{o.place_label}</p>}
          <div className="map"><MapView geometry={o.geometry} /></div>
        </section>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
