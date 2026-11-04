-- Varslingsapp initial schema. PostgreSQL 16 + PostGIS.
create extension if not exists postgis;
create extension if not exists pgcrypto;

create type account_kind   as enum ('person','company','public_body');
create type account_status as enum ('pending_profile','active','past_due','canceled','deleted');
create type user_role      as enum ('owner','member');
create type alert_level    as enum ('green','yellow','red');
create type sensitivity    as enum ('low','medium','high');
create type location_kind  as enum ('none','point','area');
create type notif_channel  as enum ('push','sms');
create type notif_state    as enum ('queued','sent','delivered','failed','acked','suppressed');

-- ---------------------------------------------------------------- reference data (seeded from config/)
create table situation_types (
  key text primary key,
  i18n jsonb not null,
  available boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now());

create table object_types (
  key text primary key,
  i18n jsonb not null,
  defaults text[] not null default '{}',
  category text not null default 'other',
  icon text not null default 'other',
  sort int not null default 0,
  updated_at timestamptz not null default now());

create table object_statuses (
  key text primary key,
  i18n jsonb not null,
  adds text[] not null default '{}',
  removes text[] not null default '{}',
  applies_to text[],                                  -- null = all object types
  sort int not null default 0,
  updated_at timestamptz not null default now());

create table event_map (
  source text not null,
  event text not null,
  situation_key text not null references situation_types(key),
  primary key (source, event));

create table level_map (
  source text not null,                               -- '*' = every source
  source_level text not null,
  level alert_level,                                  -- null = not a warning
  primary key (source, source_level));

create table advice (
  key text primary key,
  situation_key text not null references situation_types(key),
  status_key text references object_statuses(key),
  category text,
  i18n jsonb not null);

create table thresholds (
  situation_key text not null references situation_types(key),
  parameter text not null,
  green numeric, yellow numeric, red numeric,
  primary key (situation_key, parameter));

create table plans (
  key text primary key, name text not null,
  i18n jsonb not null default '{}',
  max_users int not null, max_objects int not null,
  sms_monthly_cap int not null, stripe_price_id text,
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now());

-- ---------------------------------------------------------------- accounts and users
create table accounts (
  id uuid primary key default gen_random_uuid(),
  kind account_kind not null, legal_name text, org_number text,
  plan_key text references plans(key),
  stripe_customer_id text unique, stripe_subscription_id text unique,
  stripe_checkout_session_id text unique,
  status account_status not null default 'pending_profile',
  claim_token_hash text unique,
  claim_expires_at timestamptz,
  claim_email text,
  past_due_since timestamptz,
  cancel_at_period_end boolean not null default false,
  sms_cap_warned_month text,
  terms_accepted_at timestamptz,
  adult_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  erased_at timestamptz);

create table users (
  id uuid primary key,                       -- equals Supabase auth user id
  account_id uuid not null references accounts(id),
  role user_role not null default 'member',
  can_manage_objects boolean not null default false,   -- delegated right
  name text not null, email text,
  phone_e164 text, phone_verified_at timestamptz,
  locale text not null default 'nb' check (locale in ('nb','en')),
  sms_for_all_levels boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz);
create unique index one_owner_per_account on users(account_id)
  where role = 'owner' and removed_at is null;
create index users_account_ix on users(account_id) where removed_at is null;

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  platform text not null check (platform in ('ios','android')),
  push_token text not null unique, app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz, disabled_at timestamptz);
create index devices_user_ix on devices(user_id) where disabled_at is null;

create table invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  token_hash text not null unique,
  channel text not null check (channel in ('email','sms')),
  email text, phone_e164 text, name text,
  invited_by uuid references users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz, accepted_user_id uuid references users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((channel = 'email' and email is not null) or (channel = 'sms' and phone_e164 is not null)));
create index invitations_pending_ix on invitations(account_id) where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------- objects
create table objects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  nickname text,                             -- optional (spec: object location); UI falls back to type and place
  type_key text references object_types(key),  -- null: no type chosen
  normal_status_key text not null default 'normal' references object_statuses(key),
  status_key text not null default 'normal' references object_statuses(key),
  status_until timestamptz, status_set_by uuid references users(id),
  status_version int not null default 0,
  location_kind location_kind not null default 'none',
  geom geography(Geometry, 4326),            -- point or polygon
  place_label text, county_no text, municipality_no text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((location_kind = 'none') = (geom is null)));
create index objects_geom_gix on objects using gist (geom) where deleted_at is null;
create index objects_account_ix on objects(account_id) where deleted_at is null;

create table object_situations (
  object_id uuid references objects(id) on delete cascade,
  situation_key text references situation_types(key),
  sensitivity sensitivity not null default 'high',
  primary key (object_id, situation_key));   -- no rows = use type and status defaults

create table object_recipients (              -- empty = all users of the account (D7)
  object_id uuid references objects(id) on delete cascade,
  user_id uuid references users(id),
  primary key (object_id, user_id));

-- ---------------------------------------------------------------- alerts
create table source_alerts (                  -- raw, immutable
  id uuid primary key default gen_random_uuid(),
  source text not null, source_id text not null,
  url text,
  fetched_at timestamptz not null default now(), payload jsonb not null,
  processed_at timestamptz, process_error text,
  unique (source, source_id));

create table alerts (
  id uuid primary key default gen_random_uuid(),
  source_alert_id uuid references source_alerts(id),
  source text not null, source_id text not null,
  msg_type text not null check (msg_type in ('alert','update','cancel')),
  cap_status text not null default 'Actual',
  response_type text, severity text,
  references_ids text[] not null default '{}', chain_root text not null,
  event_key text not null, situation_key text,       -- null = unmapped event
  source_level text not null,
  level alert_level,                                 -- null for all-clear and cancel
  onset timestamptz, expires timestamptz not null, sent_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  geom geography(MultiPolygon, 4326) not null,
  area_nb text,
  title_nb text, title_en text, description_nb text, description_en text,
  instruction_nb text, instruction_en text, web_url text,
  superseded_by uuid references alerts(id),
  created_at timestamptz not null default now(),
  unique (source, source_id));
create index alerts_geom_gix on alerts using gist (geom);
create index alerts_active_ix on alerts (expires) where superseded_by is null;
create index alerts_chain_ix on alerts (chain_root);
create index alerts_refs_gin on alerts using gin (references_ids);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references alerts(id),
  object_id uuid not null references objects(id),
  user_id uuid not null references users(id),
  kind text not null default 'alert' check (kind in ('alert','cancel')),
  chain_root text not null,
  level alert_level not null, channel notif_channel not null,
  state notif_state not null default 'queued',
  idempotency_key text not null unique,      -- chain_root|object|user|channel|level (|cancel)
  provider_message_id text, error text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz, delivered_at timestamptz,
  acked_at timestamptz, reminder_sent_at timestamptz);
create index notifications_user_ix on notifications (user_id, queued_at desc);
create index notifications_chain_ix on notifications (chain_root, object_id, user_id);
create index notifications_provider_ix on notifications (provider_message_id) where provider_message_id is not null;

create table push_tickets (
  id bigserial primary key,
  notification_id uuid references notifications(id) on delete cascade,
  device_id uuid not null references devices(id),
  ticket_id text,
  status text not null,                      -- ok | error
  error text,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  receipt_status text);
create index push_tickets_unchecked_ix on push_tickets (created_at) where checked_at is null and ticket_id is not null;

-- ---------------------------------------------------------------- workflows
create table change_proposals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  proposer_id uuid not null references users(id),
  kind text not null check (kind in ('object_create','object_update','object_situations','user_invite','user_remove')),
  target_id uuid,
  payload jsonb not null,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references users(id), decided_at timestamptz, note text,
  created_at timestamptz not null default now());
create index change_proposals_account_ix on change_proposals(account_id, created_at desc);

create table audit_log (
  id bigserial primary key,
  account_id uuid references accounts(id),
  actor_id uuid,
  action text not null,
  target_type text, target_id text,
  at timestamptz not null default now(),
  metadata jsonb not null default '{}');
create index audit_log_account_ix on audit_log(account_id, at desc);

create table ingest_runs (
  id bigserial primary key,
  source text not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  ok boolean, not_modified boolean not null default false,
  items_seen int not null default 0, items_new int not null default 0,
  error text);
create index ingest_runs_source_ix on ingest_runs(source, started_at desc);

create table source_state (
  source text primary key,
  last_modified text,
  next_poll_after timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz not null default now());

create table sms_usage (
  account_id uuid not null references accounts(id),
  month text not null,                       -- YYYY-MM in Europe/Oslo
  count int not null default 0,
  primary key (account_id, month));

create table processed_webhooks (
  event_id text primary key,
  type text,
  processed_at timestamptz not null default now());

-- Architecture rule 1: RLS on, no policies for client roles. Only the API and worker
-- (connecting as the table owner / service role) can read or write.
do $$
declare t text;
begin
  foreach t in array array['situation_types','object_types','object_statuses','event_map','level_map','advice','thresholds',
    'plans','accounts','users','devices','invitations','objects','object_situations','object_recipients','source_alerts',
    'alerts','notifications','push_tickets','change_proposals','audit_log','ingest_runs','source_state','sms_usage','processed_webhooks']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
