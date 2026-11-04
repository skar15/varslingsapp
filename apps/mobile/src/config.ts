import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; supabaseUrl?: string; supabaseAnonKey?: string; eas?: { projectId?: string } };
export const API_URL = extra.apiUrl ?? 'http://localhost:4000';
export const SUPABASE_URL = extra.supabaseUrl ?? '';
export const SUPABASE_ANON_KEY = extra.supabaseAnonKey ?? '';
export const EAS_PROJECT_ID = extra.eas?.projectId ?? '';
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://varslingsapp.no';
export const TILE_URL = 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';
