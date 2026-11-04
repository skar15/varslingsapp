# 002 Columns and tables added to the spec schema

Date: 2026-11-04 · Status: accepted

The spec lets the agent add columns. Added, each because a rule needs it:

| Where | Addition | Why |
| --- | --- | --- |
| objects | `nickname` nullable | Spec: "the nickname is optional"; the core DDL had `not null`. UI falls back to type and place. |
| objects | `status_version` | Status expiry jobs re-check the version (spec, temporary status). |
| objects | FK on `status_key`, `normal_status_key` | Integrity with reference data. |
| notifications | `kind` (`alert`/`cancel`), `chain_root` | A cancel push needs its own idempotency key; chain lookups without a join. |
| push_tickets | new table | Expo returns a ticket per device; receipts are checked ~15 min later. |
| source_state | new table | Last-Modified, next poll time (interval and `Expires`), last success. |
| alerts | `cap_status`, `response_type`, `severity`, `area_nb`, `fetched_at`, `source_alert_id` | Lifecycle rules and "data retrieved at" credit. |
| accounts | `claim_expires_at`, `claim_email`, `past_due_since`, `stripe_checkout_session_id`, `sms_cap_warned_month`, `terms_accepted_at`, `adult_confirmed_at`, `erased_at`, `cancel_at_period_end` | Claim TTL, grace period, idempotent account creation, 80 % warning once a month, consent record, erasure. |
| plans | `i18n`, `sort`, `active` | Plan names in nb and en. |
| event_map, level_map, advice, thresholds | reference tables | Seeded from `config/` (rule 6). |
