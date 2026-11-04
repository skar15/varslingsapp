# Runbook: stale ingest

**Signal:** `GET /v1/health/ingest` returns 503, the `stale ingest` ops alert fires (no successful poll for a source in 30 minutes), or the external heartbeat monitor misses pings.

1. Check the worker is running (`fly status`, process `worker`). Restart it if not; pg-boss resumes queued jobs.
2. Read the last runs: `select source, started_at, ok, error from ingest_runs order by id desc limit 20;`
3. `MET_USER_AGENT is not set` — set the secret and restart. Never invent a value.
4. HTTP 403/429 from MET — check the User-Agent and the poll interval; `source_state.next_poll_after` shows the back-off. Do not lower `MET_POLL_INTERVAL_SEC` below 600.
5. Parse errors — `select source, source_id, process_error from source_alerts where process_error is not null order by fetched_at desc;` Save the payload as a fixture, fix the parser, replay with `update source_alerts set processed_at = null` and enqueue `alert.process`.
6. Source outage — nothing to do; the dashboard shows "kilde utilgjengelig" and alerts are never expired early.
