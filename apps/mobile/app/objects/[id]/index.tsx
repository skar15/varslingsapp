import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatPeriod, refName, statusesForType } from '@varsling/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { api, unwrap } from '@/api';
import { useLocale, useT } from '@/i18n';
import { MapPreview } from '@/MapPreview';
import { useObject, useReference } from '@/queries';
import { Banner, Button, Card, Chip, Light, Loading, Screen, styles, T } from '@/ui';

export default function ObjectDetail() {
  const { id, extend } = useLocalSearchParams<{ id: string; extend?: string }>();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const obj = useObject(id);
  const ref = useReference();
  const [status, setStatus] = useState<string | null>(null);
  const [hours, setHours] = useState(2);
  if (!obj.data || !ref.data) return <Loading />;
  const o = obj.data;
  const r = ref.data;
  const sets = { situations: r.situation_types, types: r.object_types, statuses: r.object_statuses };
  const name = (list: { key: string; i18n: { nb: string; en?: string } }[], k: string | null) => refName(list.find((x) => x.key === k)?.i18n, locale);
  const temp = o.status_key !== o.normal_status_key;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['objects'] });
    } catch {
      Alert.alert(t('common.error'));
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: o.display_name }} />
      <Light level={o.light} />
      {o.location_kind === 'none' && <Banner>{t('object.noLocation')}</Banner>}
      <Card>
        <T bold>{t('object.activeAlerts')}</T>
        {o.alerts.length === 0 && <T muted>{t('dashboard.noAlerts')}</T>}
        {o.alerts.map((a) => (
          <Pressable key={a.id} onPress={() => router.push(`/alerts/${a.id}`)} accessibilityRole="link">
            <Light level={a.level ?? 'none'} compact />
            <T>{name(r.situation_types, a.situation_key)} · {formatPeriod(a.onset, a.expires, locale)}</T>
            {a.title && <T muted size={14}>{a.title}</T>}
          </Pressable>
        ))}
      </Card>
      <Card>
        <T bold>{t('object.status')}: {name(r.object_statuses, o.status_key)}</T>
        {o.status_until && <T>{t('object.statusUntil', { time: formatDateTime(o.status_until, locale) })}</T>}
        {o.status_set_by && <T muted>{t('object.statusSetBy', { name: o.status_set_by.name })}</T>}
        {temp && (
          <View style={{ gap: 8, borderWidth: extend ? 2 : 0, borderColor: '#1d4ed8', borderRadius: 8, padding: extend ? 8 : 0 }}>
            <View style={styles.row}>
              {[1, 2, 4, 8, 24].map((h) => <Chip key={h} label={t('object.hours', { n: h })} selected={hours === h} onPress={() => setHours(h)} />)}
            </View>
            <Button title={t('object.extendStatus')} onPress={() => run(() => unwrap(api.POST('/v1/objects/{id}/status/extend', {
              params: { path: { id } }, body: { until: new Date(Math.max(Date.now(), Date.parse(o.status_until ?? '')) + hours * 3_600_000).toISOString() },
            })))} />
            <Button title={name(r.object_statuses, o.normal_status_key)} onPress={() => run(() => unwrap(api.PUT('/v1/objects/{id}/status', { params: { path: { id } }, body: { status_key: o.normal_status_key } })))} />
          </View>
        )}
        <T muted>{t('object.setStatus')}</T>
        <View style={styles.row}>
          {statusesForType(sets, o.type_key).filter((s) => s.key !== o.status_key).map((s) => (
            <Chip key={s.key} label={name(r.object_statuses, s.key)} selected={status === s.key} onPress={() => setStatus(s.key)} />
          ))}
        </View>
        {status && (
          <>
            {status !== o.normal_status_key && (
              <View style={styles.row}>{[1, 2, 4, 8, 24, 72].map((h) => <Chip key={h} label={t('object.hours', { n: h })} selected={hours === h} onPress={() => setHours(h)} />)}</View>
            )}
            <Button kind="primary" title={t('common.save')} onPress={() => run(async () => {
              await unwrap(api.PUT('/v1/objects/{id}/status', { params: { path: { id } }, body: { status_key: status, ...(status !== o.normal_status_key ? { until: new Date(Date.now() + hours * 3_600_000).toISOString() } : {}) } }));
              setStatus(null);
            })} />
          </>
        )}
      </Card>
      <Card>
        <T bold>{t('object.situations')}</T>
        {o.monitored.map((m) => (
          <T key={m.key}>{name(r.situation_types, m.key)} – {t(`sensitivity.${m.effective_sensitivity}`)}{m.added_by_status ? ` (${t('object.situations.addedByStatus')})` : ''}</T>
        ))}
      </Card>
      {o.geometry && <MapPreview geometry={o.geometry} />}
      <View style={styles.row}>
        <Button title={o.can_edit ? t('common.edit') : t('proposals.compose')} onPress={() => router.push(`/objects/${id}/edit`)} />
        {o.can_delete && (
          <Button kind="danger" title={t('common.delete')} onPress={() => Alert.alert(t('object.delete.confirm', { name: o.display_name }), undefined, [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.delete'), style: 'destructive', onPress: () => run(async () => { await unwrap(api.DELETE('/v1/objects/{id}', { params: { path: { id } } })); router.back(); }) },
          ])} />
        )}
      </View>
    </Screen>
  );
}
