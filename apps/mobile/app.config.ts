import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Environment-specific values are injected at build time (EAS env), never committed. */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  extra: {
    ...config.extra,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? config.extra?.apiUrl,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? config.extra?.supabaseUrl,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? config.extra?.supabaseAnonKey,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? config.extra?.eas?.projectId },
  },
});
