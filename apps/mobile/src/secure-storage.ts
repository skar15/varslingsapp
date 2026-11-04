import * as SecureStore from 'expo-secure-store';

/**
 * Supabase session storage in expo-secure-store (spec: tokens in secure store). Values are
 * split in chunks because SecureStore warns above 2048 bytes per item.
 */
const CHUNK = 1800;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await SecureStore.getItemAsync(`${key}.n`);
    if (!count) return SecureStore.getItemAsync(key);
    const parts: string[] = [];
    for (let i = 0; i < Number(count); i++) parts.push((await SecureStore.getItemAsync(`${key}.${i}`)) ?? '');
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    await secureStorage.removeItem(key);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${key}.n`, String(n));
  },
  async removeItem(key: string): Promise<void> {
    const count = await SecureStore.getItemAsync(`${key}.n`);
    for (let i = 0; i < Number(count ?? 0); i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.deleteItemAsync(`${key}.n`);
    await SecureStore.deleteItemAsync(key);
  },
};
