import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { secureStorage } from './secure-storage';

export const supabase = createClient(SUPABASE_URL || 'https://not-configured.invalid', SUPABASE_ANON_KEY || 'not-configured', {
  auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function toE164(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '').replace(/^0047/, '+47');
  const withCc = digits.startsWith('+') ? digits : `+47${digits}`;
  return /^\+47\d{8}$/.test(withCc) ? withCc : null;
}
