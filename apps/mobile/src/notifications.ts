import { t, type Locale } from '@varsling/shared';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api, unwrap } from './api';
import { EAS_PROJECT_ID } from './config';
import { secureStorage } from './secure-storage';

const DEVICE_ID_KEY = 'varsling.device_id';

/** Foreground notifications show an in-app banner; the dashboard refreshes via the listener. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Android: three channels at first launch. iOS: the "Mottatt" action category.
 * Called on every start; both calls are idempotent.
 */
export async function setupNotificationChannels(locale: Locale): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alert-red', {
      name: t(locale, 'level.red'), importance: Notifications.AndroidImportance.MAX, sound: 'default', vibrationPattern: [0, 500, 250, 500], enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, bypassDnd: false,
    });
    await Notifications.setNotificationChannelAsync('alert-yellow', { name: t(locale, 'level.yellow'), importance: Notifications.AndroidImportance.HIGH, sound: 'default' });
    await Notifications.setNotificationChannelAsync('alert-info', { name: t(locale, 'app.name'), importance: Notifications.AndroidImportance.DEFAULT });
  }
  await Notifications.setNotificationCategoryAsync('alert', [
    { identifier: 'ack', buttonTitle: t(locale, 'alert.ack'), options: { opensAppToForeground: false } },
  ]);
  await Notifications.setNotificationCategoryAsync('status-extend', [
    { identifier: 'open', buttonTitle: t(locale, 'object.extendStatus'), options: { opensAppToForeground: true } },
  ]);
}

export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const s = await Notifications.getPermissionsAsync();
  return s.granted ? 'granted' : s.canAskAgain ? 'undetermined' : 'denied';
}

/**
 * Requests permission (after the explanation screen; a refused iOS dialog cannot be shown
 * again) and registers the Expo push token with the API. Android 13+ needs the runtime
 * permission, which the same call requests.
 */
export async function requestAndRegister(): Promise<boolean> {
  const res = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false, allowCriticalAlerts: true } });
  if (!res.granted) return false;
  return registerPushToken();
}

export async function registerPushToken(): Promise<boolean> {
  if (!Device.isDevice) return false;
  const { data: token } = await Notifications.getExpoPushTokenAsync(EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined);
  const r = await unwrap(api.POST('/v1/me/devices', { body: { platform: Platform.OS === 'ios' ? 'ios' : 'android', push_token: token } }));
  await secureStorage.setItem(DEVICE_ID_KEY, r.id);
  return true;
}

/** Removes the token on logout so a signed-out phone gets no alerts. */
export async function unregisterPushToken(): Promise<void> {
  const id = await secureStorage.getItem(DEVICE_ID_KEY);
  if (!id) return;
  await api.DELETE('/v1/me/devices/{id}', { params: { path: { id } } }).catch(() => undefined);
  await secureStorage.removeItem(DEVICE_ID_KEY);
}

/** The "Mottatt" action acknowledges without opening the app. */
export async function acknowledgeFromNotification(data: Record<string, unknown>): Promise<void> {
  const id = typeof data.notification_id === 'string' ? data.notification_id : null;
  if (id) await unwrap(api.POST('/v1/notifications/{id}/ack', { params: { path: { id } } }));
}

/** Maps a varsling:// URL from the payload to an in-app route. */
export function routeFromData(data: Record<string, unknown>): string | null {
  const url = typeof data.url === 'string' ? data.url : null;
  if (!url?.startsWith('varsling://')) return null;
  return `/${url.slice('varsling://'.length)}`;
}
