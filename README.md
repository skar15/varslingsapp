# Varslingsapp

Warns property owners when official weather warnings (MET MetAlerts, NVE flood and landslide) hit their registered objects — home, cabin, boat, caravan — by push, with SMS as escalation. The full specification is in [`docs/Varslingsapp – Technical Specification.md`](docs/Varslingsapp%20%E2%80%93%20Technical%20Specification.md); deviations and open points are recorded in [`docs/decisions/`](docs/decisions).

```text
apps/api       Fastify API (src/server.ts) and pg-boss worker (src/worker.ts), PostGIS schema, pipeline
apps/web       Next.js: landing and plans, Stripe checkout, registration, full dashboard
apps/mobile    Expo (Router) app for iOS and Android: dashboard, alerts, push with "Mottatt"
packages/shared      zod contracts, level mapping, monitored set, coordinate parser, geometry, i18n (nb, en)
packages/api-client  openapi-fetch client generated from the API's OpenAPI document
config/        reference data: object types, statuses, situation types, event and level maps, plans, advice
docs/          specification, decision records, runbooks
```

## Getting started

Requires Node.js 22.15 or newer (`nvm use` reads `.nvmrc`) and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env
docker compose up -d db              # PostGIS 16 (or any Postgres 16 with PostGIS)
pnpm db:migrate && pnpm db:seed      # fresh database ready to use
pnpm dev                             # API + worker on :4000, web on :3000
```

Without Supabase, Stripe, Twilio and Resend credentials the API runs with logging fakes for those providers. MET is never polled until `MET_USER_AGENT` is set to a value supplied by the project owner.

Try the pipeline without real weather (dev and staging only):

```bash
curl -X POST localhost:4000/v1/admin/simulate-alert -H "x-admin-key: $ADMIN_API_KEY" -H 'content-type: application/json' \
  -d '{"event":"wind","source_level":"orange","geometry":{"type":"Polygon","coordinates":[[[10.6,59.8],[10.9,59.8],[10.9,60],[10.6,60],[10.6,59.8]]]}}'
```

## Checks

```bash
pnpm lint && pnpm typecheck
pnpm test          # unit + integration against real PostGIS (TEST_DATABASE_URL, or Testcontainers when unset)
pnpm test:e2e      # Playwright (web); Maestro flows in apps/mobile/.maestro
pnpm api-client:generate   # after changing API schemas
eas build --profile development    # in apps/mobile
```

## Status

| Milestone | State |
| --- | --- |
| M0 Foundations | Done: monorepo, CI, Docker Compose, schema and migrations, seed, provider interfaces with fakes, health endpoints, Sentry. |
| M1 Accounts and billing | Done in code and tests with fakes. Needs real Supabase and Stripe test-mode keys to run end to end. |
| M2 Users and objects | Done. Every permission-table row and cross-account access is tested; all coordinate formats parse. |
| M3 Ingest and matching | Done against synthetic fixtures. Real MET/NVE fixtures pending (decision 006). |
| M4 Notifications | Done with fakes (A1–A7 tested). Staging run with real phones and SMS pending credentials. |
| M5 Workflows | Temporary status, proposals, removal notice, deletion, erasure and retention jobs, runbooks done. Beta, store submission and accessibility audit are operational steps. |
| M6 Forecast alerts | Not started (after MVP). Hooks: thresholds table, `wave_height`/`thaw`/`frost` hidden, forecast endpoint returns 501. |

Data: warnings from the Norwegian Meteorological Institute (CC BY 4.0) and NVE/varsom.no. varsom.no and yr.no remain authoritative; this service is best effort and not an emergency service.
