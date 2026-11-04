import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatPeriod } from '@varsling/shared';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, unwrap } from '@/api';
import { useLocale, useT } from '@/i18n';
import { MapPreview } from '@/MapPreview';
import { useAlert } from '@/queries';
import { Banner, Button, Card, Light, Loading, Screen, styles, T } from '@/ui';

/** Level badge, title, issuer, period, area, text, advice, "Mottatt", links and data credit. */
export default function AlertDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useAlert(id);
  if (!q.data) return <Loading />;
  const a = q.data;
  const credit = a.source.startsWith('nve') ? 'alert.credit.nve' : a.source === 'sim' ? 'alert.credit.sim' : 'alert.credit.met';
  const colour = ['yellow', 'orange', 'red', 'green'].includes(a.source_level) ? t(`level.colour.${a.source_level as 'yellow'}`) : a.source_level;
  return (
    <Screen>
      <Light level={a.level ?? 'none'} />
      <T bold size={20}>{a.title ?? ''}</T>
      <T muted>{t('level.sourceLevel', { issuer: a.issuer, colour })}</T>
      <Card>
        <T>{t('alert.period')}: {formatPeriod(a.onset, a.expires, locale)}</T>
        {a.description && <T>{a.description}</T>}
        {a.instruction && <><T bold>{t('alert.instruction')}</T><T>{a.instruction}</T></>}
        {a.objects.map((o) => (
          <View key={o.id} style={{ gap: 4 }}>
            <Button title={o.display_name} onPress={() => router.push(`/objects/${o.id}`)} />
            {o.advice.map((x) => <T key={x}>• {x}</T>)}
          </View>
        ))}
        {a.notification && (a.notification.acked_at ? (
          <T>✓ {t('alert.acked', { time: formatDateTime(a.notification.acked_at, locale) })}</T>
        ) : (
          <Button kind="primary" testID="ack" title={t('alert.ack')} onPress={async () => {
            await unwrap(api.POST('/v1/notifications/{id}/ack', { params: { path: { id: a.notification!.id } } }));
            await qc.invalidateQueries({ queryKey: ['alerts', id] });
          }} />
        ))}
      </Card>
      <MapPreview geometry={a.geometry} />
      <View style={styles.row}>
        <Button title="varsom.no" onPress={() => Linking.openURL('https://www.varsom.no')} />
        <Button title="yr.no" onPress={() => Linking.openURL('https://www.yr.no')} />
      </View>
      {a.level === 'red' && <Banner>{t('alert.emergency')}</Banner>}
      <T muted size={13}>{t(credit, { time: formatDateTime(a.fetched_at, locale) })}</T>
      <T muted size={13}>{t('alert.authoritative')}</T>
    </Screen>
  );
}
