'use client';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatPeriod } from '@varsling/shared';
import { useParams } from 'next/navigation';
import { Light } from '@/components/Light';
import { MapView } from '@/components/MapView';
import { api, unwrap } from '@/lib/api';
import { useHref, useLocale, useT } from '@/lib/i18n';
import { useAlert } from '@/lib/queries';

export default function AlertDetail() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const qc = useQueryClient();
  const alert = useAlert(id);
  if (alert.isLoading) return <main><p>{t('common.loading')}</p></main>;
  if (!alert.data) return <main><p className="error">{t('common.error')}</p></main>;
  const a = alert.data;
  const credit = a.source.startsWith('nve') ? 'alert.credit.nve' : a.source === 'sim' ? 'alert.credit.sim' : 'alert.credit.met';
  const colour = ['yellow', 'orange', 'red', 'green'].includes(a.source_level) ? t(`level.colour.${a.source_level as 'yellow'}`) : a.source_level;
  return (
    <main className="stack">
      <Light level={a.level ?? 'none'} />
      <h1 style={{ margin: 0 }}>{a.title}</h1>
      <p className="muted">{t('level.sourceLevel', { issuer: a.issuer, colour })}{a.superseded ? ` · ${t('alert.superseded')}` : ''}{a.msg_type === 'cancel' ? ` · ${t('alert.cancelled')}` : ''}</p>
      <div className="card stack">
        <div><strong>{t('alert.issuer')}:</strong> {a.issuer}</div>
        <div><strong>{t('alert.period')}:</strong> {formatPeriod(a.onset, a.expires, locale)}</div>
        {a.description && <div><strong>{t('alert.description')}:</strong> {a.description}</div>}
        {a.instruction && <div><strong>{t('alert.instruction')}:</strong> {a.instruction}</div>}
        {a.objects.map((o) => (
          <div key={o.id}>
            <strong>{t('alert.objects')}:</strong> <a href={href(`/objects/${o.id}`)}>{o.display_name}</a>
            {o.advice.length > 0 && <ul>{o.advice.map((x) => <li key={x}>{x}</li>)}</ul>}
          </div>
        ))}
        {a.notification && (a.notification.acked_at ? (
          <p>✓ {t('alert.acked', { time: formatDateTime(a.notification.acked_at, locale) })}</p>
        ) : (
          <button className="btn btn-primary" onClick={async () => {
            await unwrap(api.POST('/v1/notifications/{id}/ack', { params: { path: { id: a.notification!.id } } }));
            await qc.invalidateQueries({ queryKey: ['alerts', id] });
          }}>{t('alert.ack')}</button>
        ))}
      </div>
      <div className="map"><MapView geometry={a.geometry} /></div>
      <p>
        {t('alert.links')}: <a href="https://www.varsom.no" rel="noreferrer">varsom.no</a> · <a href="https://www.yr.no" rel="noreferrer">yr.no</a>
        {a.web_url && <> · <a href={a.web_url} rel="noreferrer">{a.issuer}</a></>}
      </p>
      {a.level === 'red' && <p className="banner"><strong>{t('alert.emergency')}</strong></p>}
      <p className="muted">{t(credit, { time: formatDateTime(a.fetched_at, locale) })}</p>
    </main>
  );
}
