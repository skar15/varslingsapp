'use client';
import { formatDateTime, formatPeriod, refName } from '@varsling/shared';
import { Light } from '@/components/Light';
import { useHref, useLocale, useT } from '@/lib/i18n';
import { useMe, useObjects, useReference } from '@/lib/queries';

/** One card per object with the light, type, and a one-line summary. */
export default function Dashboard() {
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const objects = useObjects();
  const ref = useReference();
  const me = useMe();
  const canAdd = me.data && me.data.user.effective_role !== 'member';
  const atLimit = me.data && me.data.limits ? me.data.account.usage.objects >= me.data.limits.max_objects : false;
  const sitName = (k: string | null) => refName(ref.data?.situation_types.find((s) => s.key === k)?.i18n, locale);

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('dashboard.title')}</h1>
        {canAdd ? (
          <a className="btn btn-primary" href={atLimit ? undefined : href('/objects/new')} aria-disabled={atLimit} title={atLimit ? t('object.limitReached') : undefined}>
            + {t('dashboard.addObject')}
          </a>
        ) : (
          <a className="btn" href={href('/proposals?compose=object_create')}>+ {t('proposals.compose')}</a>
        )}
      </div>
      {objects.data && (
        <p className="muted">
          {t('common.lastUpdated', { time: formatDateTime(objects.data.generated_at, locale) })}{' '}
          <button className="btn" onClick={() => objects.refetch()}>{t('common.retry')}</button>
        </p>
      )}
      {objects.data?.sources.filter((s) => s.stale).map((s) => (
        <p key={s.source} className="banner" role="status">
          {t('common.sourceUnavailable', { source: s.source.toUpperCase(), time: s.last_success_at ? formatDateTime(s.last_success_at, locale) : '–' })}
        </p>
      ))}
      {objects.isLoading && <p>{t('common.loading')}</p>}
      {objects.isError && <p className="error">{t('common.error')}</p>}
      {objects.data?.items.length === 0 && <p>{t('dashboard.empty')}</p>}
      <div className="grid">
        {objects.data?.items.map((o) => (
          <a key={o.id} className="card stack" href={href(`/objects/${o.id}`)} style={{ textDecoration: 'none', color: 'inherit' }} data-testid="object-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{o.display_name}</strong>
              <span className="muted">{refName(ref.data?.object_types.find((x) => x.key === o.type_key)?.i18n, locale)}</span>
            </div>
            <Light level={o.light} />
            {o.location_kind === 'none' ? (
              <p className="banner" style={{ margin: 0 }}>{t('object.noLocation')}</p>
            ) : o.summary ? (
              <span>{t('dashboard.summary', { level: t(`level.${o.summary.level}`), situation: sitName(o.summary.situation_key).toLowerCase(), period: formatPeriod(o.summary.onset, o.summary.expires, locale) })}</span>
            ) : (
              <span className="muted">{t('dashboard.noAlerts')}</span>
            )}
            {o.status_key !== o.normal_status_key && (
              <span className="badge">{refName(ref.data?.object_statuses.find((s) => s.key === o.status_key)?.i18n, locale)}{o.status_until ? ` · ${t('object.statusUntil', { time: formatDateTime(o.status_until, locale) })}` : ''}</span>
            )}
          </a>
        ))}
      </div>
    </main>
  );
}
