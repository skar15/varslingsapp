# 009 Authentication and membership

Date: 2026-11-04 · Status: accepted

- `users.id` equals the Supabase auth user id, so one login belongs to one account. Accepting an invitation with a login that belongs to another active account is refused (`409 already_member`).
- The API trusts a phone number only after reading the confirmed number from Supabase with the service key (`POST /v1/me/phone/refresh`, claim completion, invitation acceptance).
- Removing a user: the API rejects their tokens immediately (every request loads the user row), devices are disabled, and the Supabase user is banned so sessions cannot refresh. Re-inviting the same login lifts the ban.
- Registration verifies the owner's phone with Supabase phone OTP first, then optionally adds email and password for web sign-in.
