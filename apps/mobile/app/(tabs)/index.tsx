import { formatDateTime, formatPeriod, refName } from '@varsling/shared';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useLocale, useT } from '@/i18n';
import { useDashboard, useMe, useReference } from '@/queries';
import { Banner, Button, Card, Light, Loading, styles, T, useColors } from '@/ui';

/** One card per object with the light. Pull to refresh, always with the "sist oppdatert" time. */
export default function Dashboard() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const c = useColors();
  const dash = useDashboard();
  const ref = useReference();
  const me = useMe();
  if (dash.isLoading) return <Loading />;
  if (!dash.data) return <View style={{ padding: 16, gap: 12 }}><T>{t('common.error')}</T><Button title={t('common.retry')} onPress={() => dash.refetch()} /></View>;
  const { list, offline, savedAt } = dash.data;
  const sit = (k: string | null) => refName(ref.data?.situation_types.find((s) => s.key === k)?.i18n, locale);
  const atLimit = me.data?.limits ? me.data.account.usage.objects >= me.data.limits.max_objects : false;

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={list.items}
      keyExtractor={(o) => o.id}
      refreshControl={<RefreshControl refreshing={dash.isFetching} onRefresh={() => void dash.refetch()} />}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          {offline && <Banner>{t('common.offline')}</Banner>}
          <T muted size={14}>{t('common.lastUpdated', { time: formatDateTime(savedAt, locale) })}</T>
          {list.sources.filter((s) => s.stale).map((s) => (
            <Banner key={s.source}>{t('common.sourceUnavailable', { source: s.source.toUpperCase(), time: s.last_success_at ? formatDateTime(s.last_success_at, locale) : '–' })}</Banner>
          ))}
          {me.data?.account.status === 'past_due' && <Banner>{t('account.status.past_due')}</Banner>}
          <Button kind="primary" disabled={atLimit} title={`+ ${me.data?.user.effective_role === 'member' ? t('proposals.compose') : t('dashboard.addObject')}`} onPress={() => router.push('/objects/new')} testID="add-object" />
        </View>
      }
      ListEmptyComponent={<T muted>{t('dashboard.empty')}</T>}
      renderItem={({ item: o }) => (
        <Pressable onPress={() => router.push(`/objects/${o.id}`)} accessibilityRole="button" testID="object-card">
          <Card>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <T bold>{o.display_name}</T>
              <T muted size={13}>{refName(ref.data?.object_types.find((x) => x.key === o.type_key)?.i18n, locale)}</T>
            </View>
            <Light level={o.light} />
            {o.location_kind === 'none' ? (
              <Banner>{t('object.noLocation')}</Banner>
            ) : o.summary ? (
              <T>{t('dashboard.summary', { level: t(`level.${o.summary.level}`), situation: sit(o.summary.situation_key).toLowerCase(), period: formatPeriod(o.summary.onset, o.summary.expires, locale) })}</T>
            ) : (
              <T muted>{t('dashboard.noAlerts')}</T>
            )}
          </Card>
        </Pressable>
      )}
    />
  );
}
