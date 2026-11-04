import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { deviceLocale, LocaleProvider, useT } from '@/i18n';
import { acknowledgeFromNotification, registerPushToken, routeFromData, setupNotificationChannels } from '@/notifications';
import { useMe } from '@/queries';
import { supabase } from '@/supabase';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });

function useSession() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setState(data.session ? 'in' : 'out'));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setState(session ? 'in' : 'out'));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}

function Root() {
  const session = useSession();
  const me = useMe(session === 'in');
  const router = useRouter();
  const segments = useSegments();
  const qc = useQueryClient();
  const locale = me.data?.user.locale ?? deviceLocale;

  useEffect(() => {
    void setupNotificationChannels(locale);
  }, [locale]);

  // Auth gate.
  useEffect(() => {
    if (session === 'loading') return;
    const inAuth = segments[0] === 'sign-in';
    if (session === 'out' && !inAuth) router.replace('/sign-in');
    if (session === 'in' && inAuth && me.data) router.replace('/');
  }, [session, segments, me.data, router]);

  // Keep the push token registered when permission was granted earlier.
  useEffect(() => {
    if (!me.data) return;
    void Notifications.getPermissionsAsync().then((p) => (p.granted ? registerPushToken().catch(() => undefined) : undefined));
  }, [me.data]);

  // Foreground: refresh the dashboard. Tap: deep link. "Mottatt": acknowledge.
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => void qc.invalidateQueries({ queryKey: ['objects'] }));
    const handle = async (response: Notifications.NotificationResponse) => {
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      if (response.actionIdentifier === 'ack') {
        await acknowledgeFromNotification(data).catch(() => undefined);
        await qc.invalidateQueries();
        return;
      }
      const route = routeFromData(data);
      if (route) router.push(route as never);
    };
    const responded = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    void Notifications.getLastNotificationResponseAsync().then((r) => r && handle(r));
    return () => {
      received.remove();
      responded.remove();
    };
  }, [qc, router]);

  return (
    <LocaleProvider locale={locale}>
      <StatusBar style="auto" />
      <Screens />
    </LocaleProvider>
  );
}

function Screens() {
  const t = useT();
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: t('auth.signIn') }} />
      <Stack.Screen name="permission" options={{ title: t('permission.explainer.title'), presentation: 'modal' }} />
      <Stack.Screen name="objects/new" options={{ title: t('object.new') }} />
      <Stack.Screen name="objects/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="objects/[id]/edit" options={{ title: t('object.edit') }} />
      <Stack.Screen name="alerts/[id]" options={{ title: t('nav.alerts') }} />
      <Stack.Screen name="account" options={{ title: t('account.title') }} />
    </Stack>
  );
}

export default function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  );
}
