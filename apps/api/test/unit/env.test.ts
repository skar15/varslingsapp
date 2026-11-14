import { describe, expect, it } from 'vitest';
import { EnvSchema, loadEnv } from '../../src/env';

describe('loadEnv', () => {
  it('treats empty values as unset so defaults apply (.env.example placeholders)', () => {
    const env = loadEnv({ CLAIM_TOKEN_SECRET: '', SUPABASE_URL: '' });
    expect(env.CLAIM_TOKEN_SECRET).toBe(EnvSchema.shape.CLAIM_TOKEN_SECRET.parse(undefined));
    expect(env.SUPABASE_URL).toBeUndefined();
  });

  it('treats whitespace-only values as unset', () => {
    const env = loadEnv({ ADMIN_API_KEY: '   ' });
    expect(env.ADMIN_API_KEY).toBeUndefined();
  });

  it('still fails in production when required variables are missing', () => {
    expect(() => loadEnv({ APP_ENV: 'production' })).toThrow(/Missing required environment variables in production/);
  });
});
