# Runbook: SMS cost spike

**Signal:** `sms hard ceiling reached` ops alert, provider spend alert.

1. Find accounts: `select account_id, month, count from sms_usage order by count desc limit 20;`
2. Check for abuse (invitation SMS loops, OTP pumping). OTP limits are configured in Supabase Auth; only +47 numbers are allowed.
3. The per-account hard ceiling (3× cap) already stops further SMS. Lower the plan cap in `config/plans.json` and reseed if needed.
4. Review the provider's sender ID and destination rules for Norway.
