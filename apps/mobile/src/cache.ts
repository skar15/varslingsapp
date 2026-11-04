import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Offline: the last dashboard is kept with the time it was fetched, and is never shown
 * without that time ("sist oppdatert").
 */
export interface Cached<T> {
  data: T;
  savedAt: string;
}

export async function saveCache<T>(key: string, data: T): Promise<void> {
  await AsyncStorage.setItem(`cache.${key}`, JSON.stringify({ data, savedAt: new Date().toISOString() })).catch(() => undefined);
}

export async function readCache<T>(key: string): Promise<Cached<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(`cache.${key}`);
    return raw ? (JSON.parse(raw) as Cached<T>) : null;
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('cache.'));
  await AsyncStorage.multiRemove(keys);
}
