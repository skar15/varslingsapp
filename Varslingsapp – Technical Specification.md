# Varslingsapp – Technical Specification

Nov 4, 2026 · @Sander

Build a React Native (Expo) app for iOS and Android plus a Next.js web dashboard, on a Postgres/PostGIS backend that matches official MET and NVE weather warnings to each customer's registered objects and alerts them by push, with SMS as escalation.

## Scope and assumptions

The product warns property owners when weather can damage their buildings, property or belongings. The unique selling point from the slides: one account holds several locations (home, cabin, boat, caravan), and the phone is alerted for whichever object is hit.

**MVP (milestones M0–M5)**

- Paid customer account created on the web, with one owner and invited users (limit set by plan).
- Objects with location, type, status, situation types and sensitivity.
- Alerts built from official warnings (MET MetAlerts, NVE flood and landslide), routed to objects by geography.
- Push notification and SMS, acknowledgement, and a dashboard with one status light per object on web and mobile.
- Norwegian (nb) as primary language, English as secondary. Norway only.

**After MVP (M6 and later):** forecast-derived GREEN heads-up and temperature-change alerts, next-day forecast card, AI chatbot, service-provider marketplace, area-based suggestions, insurer claim reporting. Section 13 lists the design hooks to leave in place.

**Roles**

- Owner: the legal person who bought the service. Full rights, and the only one who can cancel the agreement or delete the account.
- Delegate: a member the owner has given the right to add objects and change object settings.
- Member: can view everything, change an object's status temporarily, acknowledge alerts, and send change proposals.

**Assumptions where the slides are silent**

1. The v2 note ("all alerts based on alerts from sources that contain weather data") means the app does not compute weather itself. It consumes official warnings and routes them by location. Forecast data is used only for the dashboard and the optional M6 heads-up.
2. v1 is marked obsolete. Its lists (object types, statuses, situation types, lights, sensitivity) are kept where v2 does not contradict them.
3. One account has one legal person as owner: private person, company or public body.
4. All weather data and warnings come from free, open sources that require attribution and a descriptive User-Agent.

## Decisions to confirm

The slides leave eleven points open or contradict what the data sources can deliver. The build proceeds with the default in each row until you edit it.

| # | Issue in the slides | Default used in this spec |
| --- | --- | --- |
| D1 | SMS is the only channel. SMS costs about $0.065 per message in Norway (third-party price comparison, approximate), and SMS at GREEN for HIGH sensitivity will be noisy. Push is free and supports acknowledge and deep links. | Push first. SMS is sent for RED alerts and when a user has no working push token. An unacknowledged RED alert gets one reminder by push and SMS after 15 minutes. Each user can choose "SMS for every alert". Each account gets a monthly SMS cap. |
| D2 | GREEN has no official source. MET warns at yellow, orange and red only. | Official yellow becomes app YELLOW. Official orange and red become app RED. App GREEN comes from forecast thresholds in M6. Until then HIGH sensitivity behaves like MEDIUM. |
| D3 | Mapping orange to RED may confuse users who compare with Yr or Varsom, where orange stays orange. | Store `source_level`, show "MET: orange" in the alert detail. The mapping is one config table, so adding a fourth ORANGE level later is a copy and config change. |
| D4 | Situation types with no official warning: weather change to mild, weather change to frost, wave height. | Hidden in the UI until M6 (config flag `available=false`). Available at launch: wind, gale, rain, rain flood, snow, blowing snow, ice, icing, lightning, storm surge, polar low, forest fire from MET, plus flood and landslide from NVE. |
| D5 | Slide 7 asks for trigger values per situation type and level. Official warnings carry the issuer's level, so own values are only needed for forecast-derived alerts. | Needed from M6 only. The two slide cases imply wind GREEN at about 15 m/s and YELLOW at about 20 m/s. RED is not given. Thresholds live in a table; the product owner supplies the rest before M6. |
| D6 | Customers pay on the web, then use the app. Apple may require in-app purchase for subscriptions unlocked in an app, and the rules for external payment differ by region and change over time. I could not verify the current text. | MVP sells on the web only. The app is sign-in only, with no prices and no buy buttons. Read App Store Review Guideline 3.1 before first submission. Fallback is in-app purchase through RevenueCat. |
| D7 | Slides ask whether every user gets every alert. | All users in an account get alerts for all objects. The schema already has `object_recipients`, so per-object recipients can be added in M5 without a migration of existing rows. |
| D8 | Slides suggest a receipt so the service can document that the alert was seen, and send reminders. | Implemented: a "Mottatt" button stores the acknowledgement time. One reminder after 15 minutes for unacknowledged RED alerts. |
| D9 | Personal safety and data security are listed as open topics. An alert service people rely on for protecting property carries liability, and a home location is personal data. | Terms state that varsom.no and yr.no remain authoritative and the service is best effort. Legal and privacy review (DPIA) is needed before launch and is outside this spec. |
| D10 | MET's terms say push-notification polling should not exceed one poll per 10 minutes. That caps alert latency. | Poll every 10 minutes, honour the `Expires` header, and ask MET about a faster arrangement because the use is safety related. |
| D11 | Plan names, prices, user limits and object limits are not in the slides. | Plans are rows in a table. The seed uses placeholder values. No price is hard-coded anywhere. |

Competitive note: Varsom already offers free email and SMS subscriptions for land-based natural hazard warnings from NVE and MET, and has its own app. The paid value here is object-level relevance, several locations per account, shared users, and acknowledgement, not access to the warnings themselves.

## Stack and architecture

One TypeScript codebase end to end, with Postgres and PostGIS at the centre. Every external service sits behind an interface, so the choices below can be swapped without touching the alert logic.

&#91;embedded content: architecture · 3 outside inputs, 1 worker, 1 database, 1 API\]

Warnings flow left to right through the worker. Apps never reach the database, MET or NVE directly: they ask the API, and only the worker sends notifications.

| Layer | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Mobile app | React Native with Expo (TypeScript), Expo Router, EAS Build, development builds | One codebase for iOS and Android. Push, maps and notification channels need native modules, which development builds support. | Flutter (no gain, new language). Native Swift and Kotlin (double the work; revisit only if iOS critical alerts need deeper native control). |
| Web | Next.js App Router | Landing page, checkout, onboarding and dashboard with server rendering. | Expo web for everything (weak for landing page and checkout). |
| Monorepo | pnpm workspaces and Turborepo. Packages `shared` (zod schemas, level mapping, coordinate parsing, i18n keys) and `api-client` (generated from OpenAPI). | Types and rules shared by API, web and mobile. | Separate repos. |
| API | Node 22, Fastify, zod, OpenAPI | All writes go through one API, so authorization lives in one place. | NestJS (heavier). Clients writing straight to the database (two authorization paths). |
| Database | PostgreSQL 16 with PostGIS on Supabase, EU region | Point-in-polygon matching in SQL with a GiST index. Managed backups. | Firestore and DynamoDB (no real polygon queries). |
| ORM | Drizzle with SQL migrations, raw SQL for spatial queries | Typed schema without hiding PostGIS. | Prisma (limited PostGIS support). |
| Auth | Supabase Auth with email and phone OTP. The API verifies the JWT. | OTP proves phone ownership, which SMS alerts need. | Clerk or Auth0 (extra vendor). |
| Queue and scheduler | pg-boss on the same Postgres | Retries, schedules and dead-letter queue with no Redis to run. | BullMQ with Redis (extra service). |
| Hosting | `apps/api` has a `server` and a `worker` entrypoint, deployed as containers in an EU region (for example Fly.io Stockholm). Web on Vercel with EU functions. | The worker polls and dispatches continuously. | Serverless functions for pollers (time limits, cold starts). |
| Push | expo-notifications and Expo Push Service behind a `PushProvider` interface. One Android channel per level. iOS time-sensitive interruption level for YELLOW and RED. | Shortest working path. The interface lets us move to direct FCM and APNs if delivery targets are missed. | Direct FCM and APNs from day one (more native code and token handling). |
| SMS | Twilio behind an `SmsProvider` interface. LINK Mobility adapter later. | Well documented, delivery webhooks. A Norwegian provider may be cheaper at volume (not verified). | Self-built gateway. |
| Email | Resend or Postmark | Invites and account-claim links only. Stripe sends receipts. | None. |
| Billing | Stripe Billing, Checkout, Customer Portal and Stripe Tax, webhooks into the API. Vipps MobilePay later. | Subscriptions, invoices and VAT without own invoicing code. | Own invoicing. |
| Maps and geocoding | MapLibre (React Native and web) with Kartverket tiles. Kartverket address and place-name APIs. | Free and Norway-specific. No per-map-load fee. Verify tile terms at Kartverket. | Google Maps (usage billing; the slides only name it as an example). |
| Observability | Sentry in app, web and API. pino JSON logs. Heartbeat monitor for the pollers. | A silent ingest failure is the worst failure for this product. | None. |
| Testing and CI | Vitest, Playwright (web), Maestro (mobile), Testcontainers with PostGIS. GitHub Actions, EAS Build and Submit. | Spatial queries are tested against a real PostGIS. | Mocked database for spatial code. |

**Architecture rules**

1. Only the API and worker touch the database. Row-level security stays enabled with no policies for client roles.
2. These interfaces exist from M0: `AlertSource`, `PushProvider`, `SmsProvider`, `PaymentProvider`, `Geocoder`. Each has a fake for tests.
3. Mobile and web never call MET or NVE directly. MET's terms ask apps to use a backend proxy.
4. Every alert decision is idempotent: replaying an ingest run never sends a second notification.

## Domain model and reference data

Object types, statuses and situation types are rows in reference tables seeded from JSON, so new entries never need an app release. The slides end every list with "etc.". Values marked proposed are my defaults for the product owner to review.

**Alert levels and sensitivity.** Sensitivity decides whether a user is notified. The channel rules in the notifications section decide how.

| App level | Slide wording | Light | Source |
| --- | --- | --- | --- |
| NONE | Normal, no action needed | White | No relevant alert within the next 72 hours (config `LIGHT_HORIZON_HOURS`) |
| GREEN | Action may become necessary | Green | Forecast heads-up, from M6 |
| YELLOW | Consider action | Yellow | Official yellow |
| RED | Action strongly recommended | Red | Official orange or red |

| Sensitivity | Notify at | Note |
| --- | --- | --- |
| HIGH (default, as in the slides) | GREEN, YELLOW, RED | Until M6 identical to MEDIUM |
| MEDIUM | YELLOW, RED |  |
| LOW | RED only | Official orange and red both qualify |

**Situation types.** User-facing names follow the slides. Each maps to source events.

| Key | Name (nb) | Source events | Available |
| --- | --- | --- | --- |
| `wind` | Vindstyrke | MET wind, gale, polarLow | MVP |
| `precipitation` | Store nedbørsmengder | MET rain | MVP |
| `snow` | Snø og snøfokk (added) | MET snow, blowingSnow | MVP |
| `flood` | Flomfare | NVE flood warnings, MET rainFlood | MVP |
| `landslide` | Rasfare | NVE landslide warnings | MVP |
| `storm_surge` | Stormflo (added) | MET stormSurge | MVP |
| `ice` | Is og ising (added) | MET ice, icing | MVP |
| `lightning` | Torden (added) | MET lightning | MVP |
| `forest_fire` | Skogbrannfare (added) | MET forestFire | MVP |
| `wave_height` | Bølgehøyde | Marine forecast data | M6 |
| `thaw` | Væromslag til mildvær | Forecast temperature rules | M6 |
| `frost` | Væromslag til frost | Forecast temperature rules | M6 |

**Object types and default situation types (proposed).** If the customer picks no situation types, all defaults for the type and status are monitored. Type "Annet" has no defaults and forces the customer to choose. Choosing a type is optional: with no type, the UI offers every available situation type, and if none is picked all of them are monitored.

| Object type | Key | Default situation types |
| --- | --- | --- |
| Privat bolig | `private_home` | wind, precipitation, snow, flood, landslide, ice, lightning |
| Fritidsbolig | `holiday_home` | wind, precipitation, snow, flood, landslide, ice, lightning, forest\_fire |
| Fritidsbåt | `boat` | wind, storm\_surge, ice, lightning |
| Brygge | `pier` | wind, storm\_surge, flood, ice |
| Bygning | `building` | wind, precipitation, snow, flood, landslide, ice |
| Campingvogn | `caravan` | wind, precipitation, snow, flood, lightning |
| Telt/lavvo | `tent` | wind, precipitation, snow, flood, lightning |
| Presenningsgarasje | `tarp_garage` | wind, precipitation, snow |
| Småbruk | `smallholding` | wind, precipitation, snow, flood, landslide, ice, lightning, forest\_fire |
| Annet | `other` | none, customer must choose |

**Object statuses.** A status adds situation types to what is monitored and, while active, treats the object as HIGH sensitivity for those types. This merges the two overlapping settings the slides flag as simplifiable. In the MVP the visible effect is the added situation types and tailored advice text, because GREEN does not exist before M6.

| Status | Key | Adds | Applies to |
| --- | --- | --- | --- |
| Normal (default) | `normal` | none | All |
| Gravearbeider pågår | `digging` | precipitation, flood, landslide | All |
| Utvendig arbeid på fasade og tak | `exterior_work` | wind, precipitation | Buildings |
| Løse gjenstander | `loose_items` | wind | All |
| Objekt uten tilsyn | `unattended` | wind, snow, flood, ice | All |
| Flomutsatt | `flood_prone` | flood, precipitation | All |
| Rasutsatt | `landslide_prone` | landslide, precipitation | All |
| Ligger i fortøyning | `moored` | wind, storm\_surge | Boat, pier |
| Lagret innomhus | `stored_indoors` | none; removes wind, precipitation, snow, ice, lightning | Caravan, tent |

The owner can define which status counts as "normal" for each object. Temporary statuses and their expiry are covered under business rules.

## Database schema

PostgreSQL 16 with PostGIS. The core tables are below. The agent writes them as Drizzle schema plus SQL migrations, and adds the usual `created_at` and `updated_at` columns where missing.

```sql
create extension if not exists postgis;

create type account_kind   as enum ('person','company','public_body');
create type account_status as enum ('pending_profile','active','past_due','canceled','deleted');
create type user_role      as enum ('owner','member');
create type alert_level    as enum ('green','yellow','red');
create type sensitivity    as enum ('low','medium','high');
create type location_kind  as enum ('none','point','area');
create type notif_channel  as enum ('push','sms');
create type notif_state    as enum ('queued','sent','delivered','failed','acked','suppressed');

create table plans (
  key text primary key, name text not null,
  max_users int not null, max_objects int not null,
  sms_monthly_cap int not null, stripe_price_id text);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  kind account_kind not null, legal_name text, org_number text,
  plan_key text references plans(key),
  stripe_customer_id text unique, stripe_subscription_id text unique,
  status account_status not null default 'pending_profile',
  claim_token_hash text,
  created_at timestamptz not null default now(), deleted_at timestamptz);

create table users (
  id uuid primary key,                       -- equals Supabase auth user id
  account_id uuid not null references accounts(id),
  role user_role not null default 'member',
  can_manage_objects boolean not null default false,   -- delegated right
  name text not null, email text,
  phone_e164 text, phone_verified_at timestamptz,
  locale text not null default 'nb',
  sms_for_all_levels boolean not null default false,
  created_at timestamptz not null default now(), removed_at timestamptz);
create unique index one_owner_per_account on users(account_id)
  where role = 'owner' and removed_at is null;

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  platform text not null check (platform in ('ios','android')),
  push_token text not null unique, app_version text,
  last_seen_at timestamptz, disabled_at timestamptz);

create table objects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  nickname text not null,
  type_key text references object_types(key),  -- null: no type chosen
  normal_status_key text not null default 'normal',
  status_key text not null default 'normal',
  status_until timestamptz, status_set_by uuid references users(id),
  location_kind location_kind not null default 'none',
  geom geography(Geometry, 4326),            -- point or polygon
  place_label text, county_no text, municipality_no text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(), deleted_at timestamptz,
  check ((location_kind = 'none') = (geom is null)));
create index objects_geom_gix on objects using gist (geom) where deleted_at is null;

create table object_situations (
  object_id uuid references objects(id) on delete cascade,
  situation_key text references situation_types(key),
  sensitivity sensitivity not null default 'high',
  primary key (object_id, situation_key));   -- no rows = use type and status defaults

create table source_alerts (                  -- raw, immutable
  id uuid primary key default gen_random_uuid(),
  source text not null, source_id text not null,
  fetched_at timestamptz not null default now(), payload jsonb not null,
  unique (source, source_id));

create table alerts (
  id uuid primary key default gen_random_uuid(),
  source text not null, source_id text not null,
  msg_type text not null check (msg_type in ('alert','update','cancel')),
  references_ids text[] not null default '{}', chain_root text not null,
  event_key text not null, situation_key text,       -- null = unmapped event
  source_level text not null,
  level alert_level,                                 -- null for all-clear and cancel
  onset timestamptz, expires timestamptz not null, sent_at timestamptz not null,
  geom geography(MultiPolygon, 4326) not null,
  title_nb text, title_en text, description_nb text, description_en text,
  instruction_nb text, instruction_en text, web_url text,
  superseded_by uuid references alerts(id),
  unique (source, source_id));
create index alerts_geom_gix on alerts using gist (geom);
create index alerts_active_ix on alerts (expires) where superseded_by is null;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references alerts(id),
  object_id uuid not null references objects(id),
  user_id uuid not null references users(id),
  level alert_level not null, channel notif_channel not null,
  state notif_state not null default 'queued',
  idempotency_key text not null unique,      -- chain_root|object|user|channel|level
  provider_message_id text, error text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz, delivered_at timestamptz,
  acked_at timestamptz, reminder_sent_at timestamptz);
create index notifications_user_ix on notifications (user_id, queued_at desc);
```

**Further tables (agent defines columns from the rules in this document)**

- `object_types`, `object_statuses`, `situation_types`: reference data with `key`, `i18n` (nb and en names), `available`, and for statuses `adds` and `removes` arrays.
- `object_recipients(object_id, user_id)`: empty means all users of the account (D7).
- `invitations`: token hash, target email or phone, expiry, accepted time.
- `change_proposals`: proposer, target, JSON payload, status pending, approved or rejected, decider, note.
- `audit_log`: actor, action, target, time, JSON metadata. Written for every change to users, objects, statuses and plans.
- `ingest_runs`: source, start and end time, ok flag, items seen and new, error text. Feeds the heartbeat.
- `sms_usage(account_id, month, count)`: enforces the monthly cap.
- `processed_webhooks(event_id)`: Stripe webhook idempotency.

**Rules the schema must enforce**

1. Plan limits on users and objects are checked inside the same transaction that inserts the row.
2. The `alerts.geom` column always stores WGS 84 longitude, latitude order. CAP polygons arrive as latitude, longitude pairs and must be swapped on ingest.
3. Objects with `location_kind = 'none'` are never matched and the UI shows "varsling er ikke mulig".
4. Deleting an account soft-deletes first, then a scheduled job erases personal data (names, phone numbers, emails, locations) and keeps only anonymised counts.

## Alert pipeline and data sources

Seven stages, each a separate queue job and each safe to replay. Target: a notification is queued within 60 seconds of the worker seeing a new warning, so end-to-end delay is the poll interval plus about two minutes.

1. **Poll.** One scheduled job per source. Each run writes an `ingest_runs` row. Use conditional requests. For every feed item not yet in `source_alerts`, fetch the CAP file once and store the raw payload. CAP files never change after issue.
2. **Normalise.** Parse the CAP file and prefer the Norwegian info block, with English as fallback. Read the event from `eventCode` with valueName `eventType`. Convert polygons to a WGS 84 MultiPolygon: CAP lists latitude first, PostGIS needs longitude first. Close rings, union overlapping polygons (MET allows several polygons in one area, and overlap means the union with no holes) and run `ST_MakeValid`. Map the level from `awareness_level` or severity: yellow to YELLOW, orange and red to RED. Drop CAP status Test outside dev. An event with no mapping to a situation type is stored with `situation_key` null, counted in a metric, and never notified.
3. **Lifecycle.** An Update or Cancel carries `references` as space-separated `urn:oid:sender,identifier,sent` entries. Mark every referenced alert as superseded. A downgrade arrives as an Update with responseType AllClear and severity Minor. A Cancel has responseType None and severity Minor. Both get `level` null. The chain root is the earliest referenced identifier, or the alert itself.
4. **Match.** Select objects whose geometry intersects the alert geometry, then filter in code.
5. **Decide.** Per object and recipient, create a notification row only if the level beats the chain's previous notification for that user (first alert, or level up). A same-level update or a downgrade only changes the in-app view. A Cancel or AllClear after a RED notification sends one "Varsel avlyst" push. No retroactive notifications when an object is created, moved or its sensitivity changes; the dashboard light shows the current state instead.
6. **Dispatch.** A `notify` job per notification row. Channel rules are in the notifications section. Retry with exponential backoff, then mark `failed` and raise a metric.
7. **Acknowledge.** The user taps "Mottatt" in the app, which stores `acked_at`. A reminder job runs 15 minutes after a RED notification and sends one reminder by push and SMS if there is no acknowledgement.

```sql
select o.id, o.account_id, o.type_key, o.status_key
from objects o
where o.deleted_at is null
  and o.location_kind <> 'none'
  and st_intersects(o.geom, $1::geography);
```

**Filtering in step 4.** The monitored set is the explicit `object_situations` rows, or if none, the type defaults plus the status `adds`, minus the status `removes`. For an object with no type, the default set is every available situation type. Keep the object only if the alert's `situation_key` is in that set. Effective sensitivity is HIGH for a situation the active status added, otherwise the stored value. Keep it only if the level meets the sensitivity threshold.

**Dashboard light.** Computed on read as the highest level among alerts with `onset <= now + 72h`, `expires > now`, not superseded, and a situation in the monitored set. It ignores sensitivity, because the slide describes the light as information and sensitivity as a notification setting.

**External sources**

| Source | Used for | Endpoint | Rules |
| --- | --- | --- | --- |
| MET MetAlerts 2.0 | Wind, gale, rain, rain flood, snow, blowing snow, ice, icing, lightning, storm surge, polar low, forest fire | `https://api.met.no/weatherapi/metalerts/2.0/current.rss` for the list, then each CAP file from the item link | No more than one poll per 10 minutes and never before `Expires`. Use `If-Modified-Since`. Fetch each CAP once. The `.json` GeoJSON output is beta and MET says it is not suited for high-volume production, so do not ingest from it. Use the `test` and `example` endpoints in dev only. |
| NVE flood warnings | Flood | `https://api01.nve.no/hydrology/forecast/flood/v1.0.5/api/Cap/Feed/{startdate}/{enddate}` and `/api/Cap/Id/{id}` | No authorization. The version number comes from a generated client package, so confirm the current version in NVE's API documentation before coding. |
| NVE landslide warnings | Landslide | `https://api01.nve.no/hydrology/forecast/landslide/v1.0.6/api/Cap/Feed/{startdate}/{enddate}` and `/api/Cap/Id/{id}` | Same as above. M3 starts by reading the payload and confirming how NVE's activity levels map to yellow, orange and red. |
| MET Locationforecast 2.0 | Next-day forecast card and M6 heads-up | `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={lat}&lon={lon}` | Truncate coordinates to 4 decimals (5 or more returns 403). Honour `Expires`. Backend only. Cache per rounded coordinate. |
| Kartverket address API | Address search and reverse lookup | `https://ws.geonorge.no/adresser/v1/sok` and `/punktsok` | Open, free text with wildcards. Not for bulk downloads. |
| Kartverket place names | Place search | `https://ws.geonorge.no/stedsnavn/v1/` | Open. |
| Kartverket municipality info | County and municipality number from a point | `https://ws.geonorge.no/kommuneinfo/v1/` | Open. Fills `county_no` and `municipality_no`. |

**Rules for every MET request.** Send a User-Agent with the application name and a contact address or URL, taken from the environment variable `MET_USER_AGENT`. Never use a generic or invented value: MET blocks or permanently bans clients for that. On 429, back off. Credit MET under CC BY 4.0 ("Data fra Meteorologisk institutt") and show the time the data was retrieved. Check the licence and attribution text of NVE and Kartverket data before launch.

**Testing without real weather.** In dev and staging, an admin-only endpoint creates a synthetic CAP alert for a given polygon, event and level. MET's `test` and `example` feeds exercise the parser with real structure.

## Accounts, roles and business rules

**Registration flow (customer is a private person, company or public body)**

1. The landing page shows the plans. The customer picks one and pays in Stripe Checkout.
2. The webhook `checkout.session.completed` creates an `accounts` row with status `pending_profile`, the plan, the Stripe ids and a one-time claim token. The claim link is also emailed, so a customer who closes the tab can finish later.
3. The success redirect opens the registration page, protected by the claim token. It collects: account kind, legal name, organisation number (not for private persons), owner name, email, phone number verified by OTP, acceptance of terms and privacy notice, and a confirmation of being 18 or older. Under 18 is blocked.
4. "Neste" creates the owner user, sets the account to `active` and opens the dashboard, where objects, users, notification settings and invoices are managed.

**Billing states.** Plan changes happen in the Stripe Customer Portal and arrive by webhook. A downgrade below current usage is blocked until the owner removes users or objects. On failed payment the account becomes `past_due`, the owner is told, and after a grace period (default 7 days, config `PAST_DUE_GRACE_DAYS`) alerts are paused. Only the owner can cancel. Cancellation takes effect at period end, and a deletion request starts the erasure job.

**Permissions**

| Action | Owner | Delegate | Member |
| --- | --- | --- | --- |
| View dashboard, objects and alerts | Yes | Yes | Yes |
| Acknowledge alerts | Yes | Yes | Yes |
| Change an object's status temporarily | Yes | Yes | Yes |
| Add objects and change object settings | Yes | Yes | No, sends a proposal |
| Delete objects | Yes | No | No |
| Change what counts as "normal" status | Yes | No | No |
| Add and remove users | Yes | No | No |
| Delegate rights | Yes | No | No |
| Plan, invoices, cancel, delete account | Yes | No | No |

Deleting objects is owner-only because the slides give object removal to the legal owner and delegate only add and edit rights. Confirm if you want it otherwise.

**Users**

- The users list has a plus button. At the plan limit it is shown dimmed and inactive. Pending invitations count toward the limit.
- An invitation goes by SMS or email. The invited person verifies their phone by OTP and sets their name.
- Removing a user needs a confirmation dialog. The removed user gets a notification about it, their devices are disabled and their sessions revoked.

**Temporary object status**

1. Any user can set a status other than normal, and must give an expected end time.
2. All other users get a push saying who changed which object's status.
3. At the end time the user who set it is asked whether to extend and by how long.
4. With no answer within the grace period (default 120 minutes, config `STATUS_EXTENSION_GRACE_MINUTES`), the status returns to the object's normal and everyone is notified.

Implement steps 3 and 4 as delayed pg-boss jobs that re-check the object's current status version before acting, so a manual change in between makes them do nothing.

**Change proposals.** A member sends a proposal to add an object, change an object, or change users. Object proposals go to the owner or any delegate. User proposals go to the owner only. The receiver approves or rejects with one tap. Approval applies the change through the same validated code path as a direct edit, and the proposer gets a push with the result and an optional note.

**Object location**

- Input modes: place name, address, coordinates, a point on the map, or an area drawn on the map. The area mode lets a customer avoid giving an exact address.
- Coordinates are accepted as decimal degrees, degrees and minutes, degrees minutes seconds, and UTM zones 32, 33 and 35 (ETRS89). The parser lives in `packages/shared` and has unit tests for each format.
- Areas are capped (default 2,500 km², config `MAX_AREA_KM2`), because a very large area matches nearly every alert.
- An object may be saved without a location. It shows "varsling er ikke mulig" and is never matched.
- The nickname is optional. If empty, the UI shows object type and place.

**SMS cap.** Each plan has a monthly SMS cap. At 80 percent the owner is told. Beyond the cap only RED alerts still go by SMS, up to a hard ceiling of three times the cap, which also raises an ops alert as a guard against abuse.

## API surface

REST over JSON under `/v1`. Request and response bodies are zod schemas in `packages/shared`, and the OpenAPI document served at `/v1/openapi.json` is generated from them. Authentication is a Supabase JWT in the Bearer header. Errors use problem+json. Lists use cursor pagination. Times are ISO 8601 in UTC. Rate limits apply per user and per IP.

| Method and path | Who | Purpose |
| --- | --- | --- |
| POST `/v1/billing/checkout-session` | Public | Create a Stripe Checkout session for a plan |
| POST `/v1/webhooks/stripe` | Stripe signature | Checkout, subscription and invoice events, idempotent through `processed_webhooks` |
| GET `/v1/claim/{token}` | Claim token | Read the pending account for registration |
| POST `/v1/claim/{token}/complete` | Claim token | Create the owner and activate the account |
| GET `/v1/me` | Any user | Profile, account, role, plan limits |
| PATCH `/v1/me` | Any user | Name, language, channel preferences |
| POST `/v1/me/devices` | Any user | Register a push token |
| DELETE `/v1/me/devices/{id}` | Any user | Remove a token on logout |
| GET `/v1/account` | Any user | Account, plan and usage |
| GET `/v1/users` | Any user | List users |
| POST `/v1/users/invitations` | Owner | Invite a user by SMS or email |
| POST `/v1/invitations/{token}/accept` | Invitation token | Join the account |
| DELETE `/v1/users/{id}` | Owner | Remove a user and notify them |
| PATCH `/v1/users/{id}/rights` | Owner | Delegate or withdraw the manage-objects right |
| GET `/v1/reference` | Any user | Object types, statuses, situation types, with ETag |
| GET `/v1/objects` | Any user | Objects with current light and 72-hour summary |
| POST `/v1/objects` | Owner, delegate | Create an object |
| GET `/v1/objects/{id}` | Any user | Detail with active alerts |
| PATCH `/v1/objects/{id}` | Owner, delegate | Edit name, type, location |
| DELETE `/v1/objects/{id}` | Owner | Soft delete |
| PUT `/v1/objects/{id}/situations` | Owner, delegate | Set situation types and sensitivities |
| PUT `/v1/objects/{id}/status` | Any user | Set a temporary status with an end time |
| POST `/v1/objects/{id}/status/extend` | Any user | Extend a temporary status |
| PUT `/v1/objects/{id}/normal-status` | Owner | Define what counts as normal |
| GET `/v1/objects/{id}/forecast` | Any user | Next-day forecast card (M6) |
| GET `/v1/geo/search` | Any user | Address and place search through Kartverket |
| GET `/v1/geo/reverse` | Any user | Address from a point |
| GET `/v1/alerts` | Any user | Active and recent alerts for the account's objects |
| GET `/v1/alerts/{id}` | Any user | Alert detail with text and advice |
| GET `/v1/notifications` | Any user | The caller's own notification history |
| POST `/v1/notifications/{id}/ack` | Recipient | Acknowledge |
| GET `/v1/proposals` | Owner, delegate; members see their own | List proposals |
| POST `/v1/proposals` | Member | Send a proposal |
| POST `/v1/proposals/{id}/approve` | Owner, delegate | Approve and apply |
| POST `/v1/proposals/{id}/reject` | Owner, delegate | Reject with an optional note |
| POST `/v1/admin/simulate-alert` | Admin key, dev and staging only | Create a synthetic alert for a polygon, event and level |
| GET `/v1/health` and `/v1/health/ingest` | Public, monitors | Liveness, and age of the last successful ingest per source |

Phone verification by OTP runs through Supabase Auth from the client. The API only trusts a phone number when `phone_verified_at` is set. Every endpoint checks the caller's role in one shared middleware and records changes in `audit_log`.

## Mobile and web apps

The slides require the control panel on both PC and phone. The Next.js web app holds the landing page, plans, checkout, registration and a full dashboard. The Expo app offers the same dashboard features plus push. Both use the same API and the same `api-client` package.

| Screen | Content |
| --- | --- |
| Sign in | Email with password, or phone OTP. No prices and no buy buttons (D6). A link says accounts are created on the website. |
| Dashboard | One card per object with nickname, type icon, light, and a one-line summary such as "Gult: sterk vind i morgen 06–18". A banner reads "varsling er ikke mulig" for objects without location. Pull to refresh, with a "sist oppdatert" time. |
| Object detail | Light, active and upcoming alerts, status chip with end time, situation types, sensitivity, location on a map, edit actions according to role. |
| Add or edit object | Steps: type (optional), nickname, location, status, situation types (suggested from the type, the customer can untick), sensitivity per situation type. |
| Location picker | Three tabs. Search: address or place through `/v1/geo/search`. Coordinates: one text field, parsed live with a preview. Map: drop a pin, or draw an area as a polygon of up to 20 corners or as a circle, with the area size shown against the cap. |
| Alert detail | Level badge, title, issuer (MET or NVE), period, area, description, recommended actions, the "Mottatt" button, and links to varsom.no and yr.no. Shows data credit and retrieval time. |
| Users (owner) | List, plus button (dimmed at the limit), delete with confirmation, delegate toggle. |
| Proposals | Inbox for owner and delegates. A composer for members. |
| Notification settings | Push permission state, "SMS for every alert", a test notification button. |
| Account | Plan and usage. Billing opens the Stripe Customer Portal on the web. Account deletion request. |

**Dashboard lights.** White, green, yellow and red as in the slides. Never rely on colour alone: each light also has a distinct icon and a text label, for accessibility.

**Notifications on the device**

- Android: create three channels at first launch. `alert-red` with maximum importance, sound and vibration. `alert-yellow` with high importance. `alert-info` with default importance, for reminders and status changes. Android 13 and later needs the runtime notification permission.
- iOS: show a short explanation screen before the system permission dialog, because a refused dialog cannot be shown again. Use the time-sensitive interruption level for YELLOW and RED.
- Apply to Apple for the critical alerts entitlement early, but do not depend on it. Apple grants it selectively. If granted, RED uses the critical level.
- The notification has a "Mottatt" action button that acknowledges without opening the app. Tapping the notification deep-links to the alert detail.
- Foreground notifications show an in-app banner, and the dashboard refreshes.

**Other app rules**

- Language: Norwegian (nb) by default and English, through i18n keys. Reference-data names come from the `i18n` column. Dates are shown in Europe/Oslo time.
- Offline: show the last cached dashboard with its "sist oppdatert" time. Never show stale data without that time.
- Device location is optional and only for a "use my position" button when adding an object. Foreground use only, never background location.
- Store compliance: Android target SDK current at release, iOS push capability with remote-notification background mode, privacy labels (App Store) and data safety form (Google Play) that declare location data, phone number and email.

## Notification channels and message copy

Push is the main channel. SMS is the safety net. Sensitivity decides whether a notification exists. The table decides which channels carry it.

| Event | Push | SMS |
| --- | --- | --- |
| YELLOW alert | Yes, Android channel `alert-yellow`, iOS time-sensitive | Only if the user turned on "SMS for every alert", or has no working push token |
| RED alert | Yes, Android channel `alert-red`, iOS time-sensitive or critical | Yes, immediately |
| GREEN alert (M6) | Yes, default importance | Same as YELLOW |
| RED unacknowledged after 15 minutes | One reminder | One reminder |
| Cancel or all-clear after a RED notification | One "Varsel avlyst" push | No |
| Status change by another user, proposal result | Push, channel `alert-info` | No |
| User removed, invitation | Push if the user has a device | Yes, or email |

**Push delivery.** Send through the `PushProvider`. Expo returns a ticket per message and a receipt later. Check receipts about 15 minutes after sending. On `DeviceNotRegistered`, set `devices.disabled_at`. A user with no enabled device counts as having no working push token, and gets the SMS fallback for every level.

**SMS delivery.** Send through the `SmsProvider`. Keep messages to 160 characters in the GSM 7-bit alphabet, with no emoji, because one emoji pushes the message into the 70-character format. The letters æ, ø and å are part of the GSM 7-bit set. Truncate long nicknames to 20 characters. Save the provider message id and update the state from the delivery-report webhook. Check the sender ID rules for Norway with the chosen provider before launch.

**Message copy.** The action sentence for each level comes straight from the slides. Placeholders are in braces.

| Event | Norwegian (nb) | English (en) |
| --- | --- | --- |
| GREEN | Tiltak kan bli nødvendig | Action may become necessary |
| YELLOW | Tiltak må vurderes | Consider taking action |
| RED | Tiltak er sterkt anbefalt | Action strongly recommended |
| Push title | {Farge}t varsel: {situasjon} – {objekt} | {Colour} alert: {situation} – {object} |
| Push body | {tiltakssetning}. {overskrift}. Gjelder {fra}–{til}. | {action sentence}. {headline}. Valid {from}–{to}. |
| SMS | VARSEL {NIVÅ}: {situasjon}, {objekt}. {tiltakssetning}. Gjelder {fra}–{til}. Se appen: {lenke} | ALERT {LEVEL}: {situation}, {object}. {action sentence}. Valid {from}–{to}. See the app: {link} |
| Cancelled | Varsel avlyst: {situasjon} – {objekt} | Alert cancelled: {situation} – {object} |
| Reminder | Påminnelse: rødt varsel for {objekt} er ikke bekreftet | Reminder: red alert for {object} is not acknowledged |

The message language follows `users.locale`. The alert detail adds advice that depends on the object type and status, for example advice about securing loose items when the status is "Løse gjenstander". The advice texts are reference data, not code.

## Security, privacy and reliability

The product stores where people live and tells them when to act. A silent failure or a data leak is worse than a missing feature, so these rules are part of the MVP, not polish.

**Privacy**

- Personal data held: names, phone numbers, emails, object locations (a home location is personal data), device tokens, notification history. GDPR applies in Norway through the EEA agreement.
- Minimise: offer area mode instead of an address, never store the phone's own position, never request background location.
- Host in EU or EEA regions. List all processors in the privacy notice. Data processing agreements are needed with the database host, Stripe, the SMS provider, Expo, Sentry and the email provider. Transfers to the US need a legal check.
- Retention defaults: notifications and acknowledgements 13 months (`NOTIFICATION_RETENTION_MONTHS`), audit log 24 months. Erasure runs within 30 days of a deletion request.
- Provide data export and erasure for a user, as an admin runbook in M5.
- Run a data protection impact assessment before launch. This spec does not replace legal review.

**Security**

- Every query is scoped by `account_id`. A test per endpoint tries to read and change another account's data and must fail.
- Row-level security stays enabled with no client policies. The database service key exists only on the server.
- Claim tokens and invitation tokens are random, stored as hashes, single use, and expire after 7 days.
- Verify the Stripe webhook signature and process each event id once.
- Limit OTP sends per phone number and per IP. Allow only +47 numbers at launch. Per-account SMS caps are the second guard against SMS pumping.
- Validate every input with zod. Use parameterised SQL only. Check geometry validity, vertex count and area size.
- Logs contain ids only, never phone numbers, emails or coordinates.
- The mobile app keeps tokens in `expo-secure-store`.
- The simulate-alert route is not registered when `APP_ENV` is production, and a test proves it.
- CI runs dependency audit and secret scanning.

**Reliability targets**

- A notification is queued within 60 seconds of ingest. At least 99 percent of queued notifications are attempted within 2 minutes.
- Staleness alarm: no successful poll for a source in 30 minutes pages the operator. The worker also pings an external heartbeat monitor after each successful poll, so a dead worker raises the alarm too.
- Source outage: keep retrying, never expire alerts early, and show "kilde utilgjengelig" with the last successful update on the dashboard.
- Jobs use row locking so two workers never send the same notification, and the idempotency key blocks duplicates anyway.
- If push failures exceed a threshold, RED alerts also go by SMS. The `SmsProvider` interface allows a second provider later.
- Database backups with point-in-time recovery. Run one restore drill before launch.
- Runbooks for: stale ingest, push provider outage, SMS cost spike, bad deploy. Migrations must be backward compatible so a rollback is safe.
- Scale assumption for the MVP: some thousands of objects. One worker and the GiST index are enough. Do not add caching layers before measuring.

**Product safety text**

- Terms and in-app text say the service is best effort, that varsom.no and yr.no remain authoritative, and that it is not an emergency service.
- RED alert details end with "Ved fare for liv og helse: ring 110, 112 eller 113."
- Every screen that shows weather data credits the source and shows when the data was retrieved.

## Repo layout and working rules for the coding agent

```text
varslingsapp/
  apps/
    mobile/            Expo app (Expo Router, TypeScript)
    web/               Next.js: landing, checkout, registration, dashboard
    api/               Fastify API and worker
      src/server.ts    HTTP entrypoint
      src/worker.ts    pg-boss worker entrypoint
      src/sources/     AlertSource adapters: met-alerts, nve-flood, nve-landslide
      src/domain/      matching, level mapping, decision engine, status expiry
      src/providers/   push, sms, payment, geocoder: interface, real, fake
      src/db/          Drizzle schema, migrations, seed
  packages/
    shared/            zod schemas, enums, level mapping, coordinate parser, i18n keys
    api-client/        generated from OpenAPI
  config/              reference data as JSON: object types, statuses, situation types, event map
  docs/                this specification, runbooks, decisions/
  .github/workflows/
```

```bash
pnpm install
pnpm dev                          # web, api and worker through Turborepo
pnpm db:migrate && pnpm db:seed   # fresh database ready to use
pnpm lint && pnpm typecheck
pnpm test                         # unit and integration, PostGIS in Testcontainers
pnpm test:e2e                     # Playwright for web, Maestro for mobile
eas build --profile development   # development build for device testing
```

**Environment variables.** Commit only `.env.example`.

| Variable | Purpose or default |
| --- | --- |
| `APP_ENV` | `development`, `staging` or `production` |
| `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Database and auth. The service key is server-only. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Billing |
| `EXPO_ACCESS_TOKEN` | Push sending |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SMS_SENDER_ID` | SMS |
| `MET_USER_AGENT` | Required for every MET request. Application name plus a contact address or URL supplied by the project owner. |
| `MET_POLL_INTERVAL_SEC`, `NVE_POLL_INTERVAL_SEC` | 600 |
| `LIGHT_HORIZON_HOURS` | 72 |
| `STATUS_EXTENSION_GRACE_MINUTES` | 120 |
| `PAST_DUE_GRACE_DAYS` | 7 |
| `MAX_AREA_KM2` | 2500 |
| `NOTIFICATION_RETENTION_MONTHS` | 13 |
| `HEARTBEAT_URL`, `SENTRY_DSN` | Monitoring |
| `ADMIN_API_KEY` | Simulate-alert route, non-production only |

**Working rules**

1. Read this whole document before writing code. The defaults in "Decisions to confirm" apply. Where a rule is missing, choose the simplest option, record it in `docs/decisions/NNN-title.md` and continue. Never invent thresholds, prices or legal text.
2. Build in milestone order. A milestone is done only when lint, typecheck, tests and a migration on an empty database all pass.
3. Write the test first for matching, level mapping, update and cancel handling, idempotency, coordinate parsing and permissions.
4. Test spatial code against a real PostGIS, not a mock.
5. Every external service sits behind an interface with a fake. No test touches the network. In M3, save one real example CAP file per event type from MET's `example` feed as fixtures, and real NVE payloads as fixtures.
6. Reference data and thresholds live in `config/` and are loaded by the seed. They are not hard-coded.
7. No user-facing text in components. Use i18n keys, Norwegian first.
8. Web and mobile use the generated `api-client`, never hand-written fetch calls.
9. When a real payload differs from this document, trust the payload, write a decision record, and flag it to the project owner.
10. Never call MET without `MET_USER_AGENT`. If it is unset, stop and ask for a value rather than making one up.
11. Never log secrets, phone numbers, emails or coordinates.

## Milestones and acceptance tests

| Milestone | Scope | Done when |
| --- | --- | --- |
| M0 Foundations | Monorepo, CI, Docker Compose with PostGIS, Drizzle schema and migrations for all tables, reference-data seed, provider interfaces with fakes, health endpoints, Sentry | `pnpm db:migrate && pnpm db:seed && pnpm test` passes in CI on a clean checkout |
| M1 Accounts and billing | Supabase Auth, Stripe Checkout and webhooks, claim flow, registration page, plans, `/me` and `/account`, landing and pricing page in nb and en | A test-mode payment ends with an active account whose owner can sign in on the web |
| M2 Users and objects | Invitations, user removal, delegation, permission middleware, object CRUD, location picker (search, coordinates, map point and area) on web and mobile, situation types and sensitivity, reference endpoint, mobile shell with sign in and object list | Every row of the permission table has a test. Cross-account tests pass. All coordinate formats parse. |
| M3 Ingest and matching | Adapters for MET, NVE flood and NVE landslide, normaliser, lifecycle, matching, dashboard light on read, alert endpoints, simulate-alert, `ingest_runs`, heartbeat | Replaying the fixtures (one per event type) gives the expected alerts, supersede chains and lights. Polling honours `Expires`. |
| M4 Notifications | Expo push provider, Twilio SMS provider, decision engine, dispatch jobs, receipts and delivery reports, acknowledge, reminder, SMS cap, device registration, notification settings, Android channels, iOS permission flow | A1 to A7 pass on staging with real phones and a real SMS to a test number |
| M5 Workflows and release | Temporary status with expiry jobs, change proposals, user-removal notice, account deletion, export and erasure runbook, retention jobs, accessibility pass, TestFlight and Google Play internal testing, runbooks | A two-week closed beta with real users and no missed or duplicate alert |
| M6 Forecast-derived alerts | Locationforecast integration, GREEN heads-up rules from a thresholds table, thaw and frost rules, wave height from marine forecast, next-day forecast card with a link to Yr | The product owner has supplied thresholds. Rules are tested against recorded forecast fixtures. |

**Acceptance tests.** A1 and A2 are the two cases from the slides. In the slides both start from a forecast wind speed just over a trigger value. The MVP starts from an official warning instead, so the GREEN part of case 2 waits for M6.

| ID | Scenario | Expected result |
| --- | --- | --- |
| A1 | Object "Bjørnvika", holiday home at Stræte in Grovfjord, Troms, status normal, situation wind, sensitivity MEDIUM. An official yellow wind warning covers it. | Each user gets a YELLOW notification with "Tiltak må vurderes". Light is yellow. No SMS for users on push-only settings. |
| A2 | Object "Hjemme der vi bor", private home at Andenes, status "Utvendig arbeid på fasade og tak", wind, HIGH. An official yellow wind warning covers it. | YELLOW notification. Precipitation is also monitored because the status added it. The GREEN notification "Tiltak kan bli nødvendig" is tested in M6. |
| A3 | Sensitivity LOW. A yellow warning, then an orange warning. | No notification for yellow. A RED notification for orange. |
| A4 | Object with no location. | Never matched. UI shows "varsling er ikke mulig". |
| A5 | Yellow warning, then an update to orange, then a same-level update, then the whole ingest replayed. | Exactly two notifications, YELLOW then RED. No duplicates. |
| A6 | A cancel arrives after a RED notification. | One "Varsel avlyst" push. |
| A7 | A RED notification is not acknowledged. Another is acknowledged. | A reminder after 15 minutes for the first only. |
| A8 | A user sets "Utvendig arbeid" for 2 hours. | Others are told who changed it. At the end the user is asked to extend. With no answer in 120 minutes the status returns to normal and everyone is told. |
| A9 | A member sends a proposal to add an object. | The owner approves in one tap, the object exists, the member gets the result. |
| A10 | The plan allows 3 users and there are 2 users and 1 pending invitation. | The plus button is dimmed. The API refuses a fourth. |
| A11 | The owner removes a user. | The user is notified, sessions are revoked, devices are disabled. |
| A12 | Any endpoint called with another account's ids. | Always refused. |
| A13 | A CAP polygon given as latitude, longitude pairs, and a multi-polygon area with overlap. | A point known to be inside matches. The overlap is handled as one union. |

**Later phases and the hooks to leave in place**

- AI chatbot: keep alerts and objects readable through a narrow read-only service layer, keep advice text as reference data, and send no personal data in prompts. Ready-made prompts become reference data.
- Service providers in the app: leave a slot for "Få hjelp" on the alert detail. Add `providers` and `provider_requests` tables later, where providers can request a connection.
- Area-based suggestions: always fill `municipality_no`. The alert history then shows the most common events per municipality, for example basement flooding, and can suggest situation types when an object is added.
- Insurer claim notification: notification and acknowledgement rows are the evidence. Add an export of an object's alert history, and a `claims` table later.
- Premium discount from lower payouts (slide 1): needs an insurer partner and is a business track, not a build item.

## Sources

Product requirements come from the slides in Varslingsapp.pdf. Integration details were checked on 4 November 2026.

**Pages opened and read**

- [MetAlerts 2.0 documentation](https://api.met.no/weatherapi/metalerts/2.0/GeoJSON): endpoints, alert levels, event types, filters, polling guidance, GeoJSON beta status.
- [MetAlerts CAP v2 profile](https://docs.api.met.no/doc/metalerts/CAP-v2-profile): message types, references, all-clear and cancel handling, polygon format.
- [MET Weather API terms of service](https://developer.yr.no/doc/TermsOfService): User-Agent, request limits, 4-decimal coordinates, CC BY 4.0, backend proxy rule.

**Seen in search results only. Verify before relying on them**

- NVE flood and landslide API paths and version numbers, from generated clients: [flood](https://pypi.org/project/varsom-flood-client) and [landslide](https://pypi.org/project/varsom-landslide-client).
- [Varsom news on the landslide service](https://www.varsom.no/en/news/general/the-norwegian-landslide-early-warning-service-turns-10-years-old/): mentions free email and SMS subscriptions for land-based warnings.
- Kartverket address API: [QGIS plugin page](https://plugins.qgis.org/plugins/kartverket_adresse/) and [INSPIRE record](https://inspire-geoportal.ec.europa.eu/srv/api/records/44eeffdc-6069-4000-a49b-2d6bfc59ac61). The place-name and municipality endpoints come from a [third-party MCP listing](https://claudemarketplaces.com/mcp/io.github.3121n/kartverket-mcp).
- [Norway SMS price comparison](https://sent.dm/resources/norway-sms-pricing): approximate per-message prices from a third party.
- [LINK Mobility sender ID guidance for Norway](https://docs.linkmobility.com/regulatory-guidelines/sender-id/norway).
- Expo push guides: [Courier](https://www.courier.com/blog/expo-notifications) and [DEV Community](https://dev.to/russel_dsouza_bd584a3cb2a/push-notifications-in-react-native-the-complete-2026-guide-2d4g).
