import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Switch, View } from 'react-native';
import { api, unwrap } from '@/api';
import { clearCache } from '@/cache';
import { useT } from '@/i18n';
import { permissionStatus, requestAndRegister, unregisterPushToken } from '@/notifications';
import { useMe } from '@/queries';
import { supabase } from '@/supabase';
import { Button, Card, Chip, Loading, Screen, styles, T } from '@/ui';

/** Notification settings: push permission state, "SMS for every alert", test notification. */
export default function Settings() {
  const t = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const me = useMe();
  const [perm, setPerm] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const [sent, setSent] = useState(false);
  useFocusEffect(useCallback(() => void permissionStatus().then(setPerm), []));
  if (!me.data) return <Loading />;
  const u = me.data.user;
  const patch = async (body: { sms_for_all_levels?: boolean; locale?: 'nb' | 'en' }) => {
    await unwrap(api.PATCH('/v1/me', { body }));
    await qc.invalidateQueries({ queryKey: ['me'] });
  };
  return (
    <Screen>
      <Card>
        <T bold>{t('settings.pushPermission')}</T>
        <T>{t(`settings.push.${perm}`)}</T>
        {perm === 'undetermined' && <Button kind="primary" title={t('permission.explainer.continue')} onPress={() => router.push('/permission')} />}
        {perm === 'denied' && <Button title={t('settings.pushPermission')} onPress={() => Linking.openSettings()} />}
        {perm === 'granted' && <Button title={t('settings.test')} onPress={async () => { await requestAndRegister().catch(() => false); await unwrap(api.POST('/v1/me/test-notification')); setSent(true); }} />}
        {sent && <T>{t('settings.testSent')}</T>}
      </Card>
      <Card>
        <View style={styles.row}>
          <Switch value={u.sms_for_all_levels} onValueChange={(v) => void patch({ sms_for_all_levels: v })} accessibilityLabel={t('settings.smsAll')} />
          <T>{t('settings.smsAll')}</T>
        </View>
        <T muted size={14}>{t('settings.smsAll.help')}</T>
      </Card>
      <Card>
        <T bold>{t('settings.language')}</T>
        <View style={styles.row}>
          <Chip label="Norsk" selected={u.locale === 'nb'} onPress={() => void patch({ locale: 'nb' })} />
          <Chip label="English" selected={u.locale === 'en'} onPress={() => void patch({ locale: 'en' })} />
        </View>
      </Card>
      <Button title={t('account.title')} onPress={() => router.push('/account')} />
      <Button title={t('common.signOut')} onPress={async () => {
        await unregisterPushToken();
        await clearCache();
        await supabase.auth.signOut();
        qc.clear();
      }} />
    </Screen>
  );
}
