# Runbook: bad deploy

1. Roll back the image (`fly releases`, `fly deploy --image <previous>`). Migrations are backward compatible by rule, so the previous version runs on the new schema.
2. If a migration itself is broken, fix forward with a new migration; never edit an applied one.
3. Verify `GET /v1/health`, `GET /v1/health/ingest`, and a simulate-alert on staging.
