import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';

export interface AuthIdentity {
  sub: string;
  email: string | null;
  phone: string | null;
}

export interface AuthVerifier {
  verify(token: string): Promise<AuthIdentity>;
}

/**
 * Verifies Supabase access tokens. Uses the project's JWKS (asymmetric signing keys) when
 * no legacy HS256 secret is configured.
 */
export class SupabaseJwtVerifier implements AuthVerifier {
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly secret?: Uint8Array;
  constructor(opts: { supabaseUrl?: string; jwtSecret?: string; issuer?: string }) {
    if (opts.jwtSecret) this.secret = new TextEncoder().encode(opts.jwtSecret);
    else if (opts.supabaseUrl) this.jwks = createRemoteJWKSet(new URL(`${opts.supabaseUrl}/auth/v1/.well-known/jwks.json`));
    else throw new Error('SUPABASE_URL or SUPABASE_JWT_SECRET is required');
  }

  async verify(token: string): Promise<AuthIdentity> {
    const opts = { audience: 'authenticated' };
    const { payload } = this.secret ? await jwtVerify(token, this.secret, opts) : await jwtVerify(token, this.jwks!, opts);
    return identity(payload);
  }
}

function identity(p: JWTPayload): AuthIdentity {
  if (!p.sub) throw new Error('token has no subject');
  const phone = typeof p.phone === 'string' && p.phone ? (p.phone.startsWith('+') ? p.phone : `+${p.phone}`) : null;
  return { sub: p.sub, email: typeof p.email === 'string' && p.email ? p.email : null, phone };
}

/** Test helper: signs tokens the way Supabase does with a shared HS256 secret. */
export async function signTestToken(secret: string, claims: { sub: string; email?: string; phone?: string }): Promise<string> {
  return new SignJWT({ email: claims.email, phone: claims.phone?.replace(/^\+/, ''), role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

export interface AuthUserRecord {
  id: string;
  email: string | null;
  email_confirmed: boolean;
  phone: string | null;
  phone_confirmed: boolean;
}

/** Server-side Supabase Auth admin operations (service role key never leaves the server). */
export interface AuthAdmin {
  getUser(id: string): Promise<AuthUserRecord | null>;
  /** Revokes sessions and blocks new ones (used when a user is removed). */
  revoke(id: string): Promise<void>;
  /** Lifts a revoke (used when a removed user is invited again). */
  restore(id: string): Promise<void>;
}

export class SupabaseAuthAdmin implements AuthAdmin {
  constructor(private readonly url: string, private readonly serviceKey: string) {}
  private headers() {
    return { apikey: this.serviceKey, authorization: `Bearer ${this.serviceKey}`, 'content-type': 'application/json' };
  }
  async getUser(id: string): Promise<AuthUserRecord | null> {
    const res = await fetch(`${this.url}/auth/v1/admin/users/${id}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`supabase admin HTTP ${res.status}`);
    const u = (await res.json()) as { id: string; email?: string; email_confirmed_at?: string | null; phone?: string; phone_confirmed_at?: string | null };
    return {
      id: u.id,
      email: u.email || null,
      email_confirmed: !!u.email_confirmed_at,
      phone: u.phone ? (u.phone.startsWith('+') ? u.phone : `+${u.phone}`) : null,
      phone_confirmed: !!u.phone_confirmed_at,
    };
  }
  private async ban(id: string, duration: string) {
    const res = await fetch(`${this.url}/auth/v1/admin/users/${id}`, { method: 'PUT', headers: this.headers(), body: JSON.stringify({ ban_duration: duration }) });
    if (!res.ok) throw new Error(`supabase admin HTTP ${res.status}`);
  }
  async revoke(id: string) {
    await this.ban(id, '876000h');
  }
  async restore(id: string) {
    await this.ban(id, 'none');
  }
}

export class FakeAuthAdmin implements AuthAdmin {
  users = new Map<string, AuthUserRecord>();
  revoked = new Set<string>();
  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async revoke(id: string) {
    this.revoked.add(id);
  }
  async restore(id: string) {
    this.revoked.delete(id);
  }
}
