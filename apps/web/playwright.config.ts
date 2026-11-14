import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';

/** Values from the repo-root .env, if there is one. Only read, never copied wholesale into process.env. */
function rootEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'));
  } catch {
    return {};
  }
}

const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
// Precedence: E2E_DATABASE_URL, then DATABASE_URL from the environment, then from the root .env, then the default.
// `||` skips empty strings, so blank placeholders (`DATABASE_URL=`) fall through to the next source.
const dbUrl =
  process.env.E2E_DATABASE_URL ||
  process.env.DATABASE_URL ||
  rootEnv().DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/varsling';

/** Web e2e: runs the real API (dev entrypoint: migrate + seed + worker) and the built web app. */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3100', launchOptions: { executablePath } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @varsling/api exec tsx src/dev.ts',
      url: 'http://localhost:4100/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { PORT: '4100', APP_ENV: 'development', DATABASE_URL: dbUrl, LOG_LEVEL: 'warn', NVE_ENABLED: 'false', STRIPE_PRICE_ID_FAMILIE: 'price_e2e_familie' },
    },
    {
      command: 'pnpm exec next start -p 3100',
      url: 'http://localhost:3100/nb',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: 'http://localhost:4100', API_INTERNAL_URL: 'http://localhost:4100' },
    },
  ],
});
