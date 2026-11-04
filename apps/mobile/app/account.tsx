import { refName } from '@varsling/shared';
import { useState } from 'react';
import { Linking } from 'react-native';
import { api, unwrap } from '@/api';
import { WEB_URL } from '@/config';
import { useLocale, useT } from '@/i18n';
import { useAccount, useMe } from '@/queries';
import { supabase } from '@/supabase';
import { Banner, Button, Card, Field, Loading, Screen, T } from '@/ui';

/** Plan and usage. Billing is on the web (D6: no purchases in the app). Account deletion request. */
export default function Account() {
  const t = useT();
  const locale = useLocale();
  const me = useMe();
  const q = useAccount();
  const [confirm, setConfirm] = useState('');
  if (!q.data || !me.data) return <Loading />;
  const a = q.data;
  const isOwner = me.data.user.effective_role === 'owner';
  return (
    <Screen>
      <Card>
        <T bold>{t('account.plan')}: {a.plan ? refName(a.plan.name, locale) : '–'}</T>
        {a.plan && (
          <>
            <T>{t('account.usage.users', { used: a.usage.users + a.usage.pending_invitations, max: a.plan.max_users })}</T>
            <T>{t('account.usage.objects', { used: a.usage.objects, max: a.plan.max_objects })}</T>
            <T>{t('account.usage.sms', { used: a.usage.sms_this_month, max: a.plan.sms_monthly_cap })}</T>
          </>
        )}
        {a.status === 'past_due' && <Banner>{t('account.status.past_due')}</Banner>}
        <T muted>{t('account.billingOnWeb')}</T>
        <Button title={WEB_URL.replace(/^https?:\/\//, '')} onPress={() => Linking.openURL(`${WEB_URL}/${locale}/account`)} />
      </Card>
      {isOwner && (
        <Card>
          <T bold>{t('account.delete')}</T>
          <T>{t('account.delete.confirm')}</T>
          <Field label={t('account.delete')} value={confirm} onChangeText={setConfirm} autoCapitalize="characters" />
          <Button kind="danger" title={t('account.delete')} disabled={confirm !== t('account.delete.word')} onPress={async () => {
            await unwrap(api.POST('/v1/account/deletion-request', { body: { confirm: true } }));
            await supabase.auth.signOut();
          }} />
        </Card>
      )}
    </Screen>
  );
}
