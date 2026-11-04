# 007 Pipeline job boundaries and poll cadence

Date: 2026-11-04 · Status: accepted

- Normalise and lifecycle run in one job (`alert.process`) and one transaction, so an alert row never exists without its supersede links. Match and decide run in `alert.match`; each notification is its own `notify.dispatch` job. Every step is idempotent (unique source ids, `idempotency_key`).
- A one-minute `ingest.tick` wakes the pollers; each source decides itself whether it is due (`MET_POLL_INTERVAL_SEC` ≥ 600, never before `Expires`, back-off on 429).
- An alert that is already superseded when matched (replay or out-of-order arrival) never notifies; it only changes the in-app view.
