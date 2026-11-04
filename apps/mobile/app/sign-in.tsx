import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ApiError, api, unwrap } from '@/api';
import { useT } from '@/i18n';
import { supabase, toE164 } from '@/supabase';
import { Banner, Button, Card, Chip, Field, Screen, styles, T } from '@/ui';
import { View } from 'react-native';

/** Sign-in only: no prices and no buy buttons (D6). Accounts are created on the website. */
export default function SignIn() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function done() {
    try {
      await unwrap(api.GET('/v1/me'));
      await qc.invalidateQueries();
      router.replace('/permission');
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'not_a_member' ? t('auth.notMember') : t('auth.error'));
      await supabase.auth.signOut();
    }
  }

  return (
    <Screen>
      <View style={styles.row}>
        <Chip label={t('auth.withPhone')} selected={mode === 'phone'} onPress={() => setMode('phone')} />
        <Chip label={t('auth.withEmail')} selected={mode === 'email'} onPress={() => setMode('email')} />
      </View>
      <Card>
        {mode === 'email' ? (
          <>
            <Field label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" testID="email" />
            <Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" testID="password" />
            <Button kind="primary" title={t('auth.signIn')} testID="sign-in" onPress={async () => {
              setError(null);
              const { error: err } = await supabase.auth.signInWithPassword({ email, password });
              if (err) return setError(t('auth.error'));
              await done();
            }} />
          </>
        ) : !sentTo ? (
          <>
            <Field label={t('auth.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="+47 912 34 567" />
            <Button kind="primary" title={t('auth.sendCode')} onPress={async () => {
              const e164 = toE164(phone);
              if (!e164) return setError(t('auth.onlyNorwegianNumbers'));
              const { error: err } = await supabase.auth.signInWithOtp({ phone: e164, options: { shouldCreateUser: false } });
              if (err) return setError(t('auth.error'));
              setError(null);
              setSentTo(e164);
            }} />
          </>
        ) : (
          <>
            <Field label={t('auth.code')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" />
            <Button kind="primary" title={t('auth.verify')} onPress={async () => {
              const { error: err } = await supabase.auth.verifyOtp({ phone: sentTo, token: code.trim(), type: 'sms' });
              if (err) return setError(t('auth.error'));
              await done();
            }} />
          </>
        )}
        {error && <T color="#b42318">{error}</T>}
      </Card>
      <Banner tone="info">{t('auth.accountsOnWeb')}</Banner>
    </Screen>
  );
}
