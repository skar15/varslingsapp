'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

export async function accessToken(): Promise<string | null> {
  if (!SUPABASE_URL) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Norwegian numbers only at launch: "912 34 567" -> "+4791234567". */
export function toE164(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '').replace(/^0047/, '+47');
  const withCc = digits.startsWith('+') ? digits : `+47${digits}`;
  return /^\+47\d{8}$/.test(withCc) ? withCc : null;
}
