import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { api, ApiError, unwrap } from '@/api';
import { useT } from '@/i18n';
import { useMe, useUsers } from '@/queries';
import { toE164 } from '@/supabase';
import { Button, Card, Chip, Field, Loading, Screen, styles, T } from '@/ui';

/** Users: list, plus button dimmed at the plan limit, delete with confirmation, delegate toggle. */
export default function Users() {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe();
  const q = useUsers();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [target, setTarget] = useState('');
  if (!q.data || !me.data) return <Loading />;
  const isOwner = me.data.user.effective_role === 'owner';
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  async function invite() {
    try {
      if (channel === 'sms') {
        const phone = toE164(target);
        if (!phone) return Alert.alert(t('auth.onlyNorwegianNumbers'));
        await unwrap(api.POST('/v1/users/invitations', { body: { channel: 'sms', phone_e164: phone } }));
      } else await unwrap(api.POST('/v1/users/invitations', { body: { channel: 'email', email: target.trim() } }));
      setOpen(false);
      setTarget('');
      await refresh();
    } catch (err) {
      Alert.alert(err instanceof ApiError && err.code === 'plan_limit_users' ? t('users.limit', { max: q.data!.max_users }) : t('common.error'));
    }
  }

  return (
    <Screen>
      {isOwner && <Button kind="primary" title={`+ ${t('users.invite')}`} disabled={!q.data.can_invite} onPress={() => setOpen(!open)} testID="invite-plus" />}
      {isOwner && !q.data.can_invite && <T muted>{t('users.limit', { max: q.data.max_users })}</T>}
      {open && (
        <Card>
          <View style={styles.row}>
            <Chip label={t('users.invitePhone')} selected={channel === 'sms'} onPress={() => setChannel('sms')} />
            <Chip label={t('users.inviteEmail')} selected={channel === 'email'} onPress={() => setChannel('email')} />
          </View>
          <Field label={channel === 'sms' ? t('auth.phone') : t('auth.email')} value={target} onChangeText={setTarget} autoCapitalize="none" keyboardType={channel === 'sms' ? 'phone-pad' : 'email-address'} />
          <Button kind="primary" title={t('users.invite')} onPress={() => void invite()} />
        </Card>
      )}
      {q.data.items.map((u) => (
        <Card key={u.id}>
          <T bold>{u.name} {u.id === me.data!.user.id ? t('users.you') : ''}</T>
          <T muted>{t(`role.${u.effective_role}`)}</T>
          {isOwner && u.role === 'member' && (
            <>
              <View style={styles.row}>
                <Switch value={u.can_manage_objects} accessibilityLabel={t('users.delegate')} onValueChange={async (v) => {
                  await unwrap(api.PATCH('/v1/users/{id}/rights', { params: { path: { id: u.id } }, body: { can_manage_objects: v } }));
                  await refresh();
                }} />
                <T>{t('users.delegate')}</T>
              </View>
              <Button kind="danger" title={t('common.delete')} onPress={() => Alert.alert(t('users.remove.confirm', { name: u.name }), undefined, [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.delete'), style: 'destructive', onPress: async () => { await unwrap(api.DELETE('/v1/users/{id}', { params: { path: { id: u.id } } })); await refresh(); } },
              ])} />
            </>
          )}
        </Card>
      ))}
      {q.data.invitations.map((i) => (
        <Card key={i.id}><T>{i.name ?? i.target}</T><T muted>{t('users.pending')}</T></Card>
      ))}
    </Screen>
  );
}
