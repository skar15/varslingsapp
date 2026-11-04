# Runbook: push provider outage

**Signal:** `notification_failed` metrics, `push receipt failure rate high` ops alert, Expo status page.

1. RED alerts already go by SMS too, and failed pushes create SMS fallbacks for verified phones.
2. Check failures: `select state, channel, count(*) from notifications where queued_at > now() - interval '1 hour' group by 1,2;`
3. If Expo is down for long, consider temporarily setting every user's `sms_for_all_levels` (watch the SMS cap) and notify customers.
4. After recovery, failed rows are not retried automatically; re-queue recent ones only if still relevant: set `state='queued'` for rows from the last hour and enqueue `notify.dispatch`.
