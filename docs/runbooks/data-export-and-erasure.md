# Runbook: data export and erasure for a user (GDPR)

**Export** (access request):

```sql
select id, name, email, phone_e164, locale, created_at from users where id = :user_id;
select o.nickname, o.type_key, o.place_label, st_asgeojson(o.geom::geometry) from objects o join users u on u.account_id = o.account_id where u.id = :user_id and o.deleted_at is null;
select alert_id, object_id, level, channel, state, queued_at, acked_at from notifications where user_id = :user_id;
select action, target_type, target_id, at from audit_log where actor_id = :user_id;
```

Deliver as JSON to the verified email of the user.

**Erasure of one user** (not the whole account): the owner removes the user in the app, then:

```sql
update users set name = 'slettet', email = null, phone_e164 = null, phone_verified_at = null where id = :user_id;
delete from devices where user_id = :user_id;
```

**Whole account:** the owner requests deletion in the app; the daily `maintenance.erasure` job completes it (decision 010). Erasure must complete within 30 days of the request.

**Restore drill** (before launch): restore the latest point-in-time backup to a scratch project, run `pnpm db:migrate`, and check `select count(*) from objects` against production.
