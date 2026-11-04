/**
 * Drizzle schema. Mirrors db/migrations/*.sql, which is the source of truth for DDL
 * (PostGIS columns, partial indexes and RLS are written by hand). A test checks that
 * every table and column declared here exists in a freshly migrated database.
 * Spatial queries use raw SQL (spec: Drizzle with raw SQL for spatial queries).
 */
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, customType, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';

const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography';
  },
});
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const accountKind = pgEnum('account_kind', ['person', 'company', 'public_body']);
export const accountStatus = pgEnum('account_status', ['pending_profile', 'active', 'past_due', 'canceled', 'deleted']);
export const userRole = pgEnum('user_role', ['owner', 'member']);
export const alertLevel = pgEnum('alert_level', ['green', 'yellow', 'red']);
export const sensitivity = pgEnum('sensitivity', ['low', 'medium', 'high']);
export const locationKind = pgEnum('location_kind', ['none', 'point', 'area']);
export const notifChannel = pgEnum('notif_channel', ['push', 'sms']);
export const notifState = pgEnum('notif_state', ['queued', 'sent', 'delivered', 'failed', 'acked', 'suppressed']);

export const situationTypes = pgTable('situation_types', {
  key: text('key').primaryKey(),
  i18n: jsonb('i18n').notNull(),
  available: boolean('available').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const objectTypes = pgTable('object_types', {
  key: text('key').primaryKey(),
  i18n: jsonb('i18n').notNull(),
  defaults: text('defaults').array().notNull().default(sql`'{}'`),
  category: text('category').notNull(),
  icon: text('icon').notNull(),
  sort: integer('sort').notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const objectStatuses = pgTable('object_statuses', {
  key: text('key').primaryKey(),
  i18n: jsonb('i18n').notNull(),
  adds: text('adds').array().notNull(),
  removes: text('removes').array().notNull(),
  appliesTo: text('applies_to').array(),
  sort: integer('sort').notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const eventMap = pgTable('event_map', {
  source: text('source').notNull(),
  event: text('event').notNull(),
  situationKey: text('situation_key').notNull(),
}, (t) => [primaryKey({ columns: [t.source, t.event] })]);

export const levelMap = pgTable('level_map', {
  source: text('source').notNull(),
  sourceLevel: text('source_level').notNull(),
  level: alertLevel('level'),
}, (t) => [primaryKey({ columns: [t.source, t.sourceLevel] })]);

export const advice = pgTable('advice', {
  key: text('key').primaryKey(),
  situationKey: text('situation_key').notNull(),
  statusKey: text('status_key'),
  category: text('category'),
  i18n: jsonb('i18n').notNull(),
});

export const thresholds = pgTable('thresholds', {
  situationKey: text('situation_key').notNull(),
  parameter: text('parameter').notNull(),
  green: numeric('green'),
  yellow: numeric('yellow'),
  red: numeric('red'),
}, (t) => [primaryKey({ columns: [t.situationKey, t.parameter] })]);

export const plans = pgTable('plans', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  i18n: jsonb('i18n').notNull(),
  maxUsers: integer('max_users').notNull(),
  maxObjects: integer('max_objects').notNull(),
  smsMonthlyCap: integer('sms_monthly_cap').notNull(),
  stripePriceId: text('stripe_price_id'),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: accountKind('kind').notNull(),
  legalName: text('legal_name'),
  orgNumber: text('org_number'),
  planKey: text('plan_key'),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
  status: accountStatus('status').notNull().default('pending_profile'),
  claimTokenHash: text('claim_token_hash'),
  claimExpiresAt: ts('claim_expires_at'),
  claimEmail: text('claim_email'),
  pastDueSince: ts('past_due_since'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  smsCapWarnedMonth: text('sms_cap_warned_month'),
  termsAcceptedAt: ts('terms_accepted_at'),
  adultConfirmedAt: ts('adult_confirmed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
  erasedAt: ts('erased_at'),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  role: userRole('role').notNull().default('member'),
  canManageObjects: boolean('can_manage_objects').notNull().default(false),
  name: text('name').notNull(),
  email: text('email'),
  phoneE164: text('phone_e164'),
  phoneVerifiedAt: ts('phone_verified_at'),
  locale: text('locale').notNull().default('nb'),
  smsForAllLevels: boolean('sms_for_all_levels').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  removedAt: ts('removed_at'),
});

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  platform: text('platform').notNull(),
  pushToken: text('push_token').notNull().unique(),
  appVersion: text('app_version'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at'),
  disabledAt: ts('disabled_at'),
});

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  channel: text('channel').notNull(),
  email: text('email'),
  phoneE164: text('phone_e164'),
  name: text('name'),
  invitedBy: uuid('invited_by'),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  acceptedUserId: uuid('accepted_user_id'),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const objects = pgTable('objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull(),
  nickname: text('nickname'),
  typeKey: text('type_key'),
  normalStatusKey: text('normal_status_key').notNull().default('normal'),
  statusKey: text('status_key').notNull().default('normal'),
  statusUntil: ts('status_until'),
  statusSetBy: uuid('status_set_by'),
  statusVersion: integer('status_version').notNull().default(0),
  locationKind: locationKind('location_kind').notNull().default('none'),
  geom: geography('geom'),
  placeLabel: text('place_label'),
  countyNo: text('county_no'),
  municipalityNo: text('municipality_no'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
});

export const objectSituations = pgTable('object_situations', {
  objectId: uuid('object_id').notNull(),
  situationKey: text('situation_key').notNull(),
  sensitivity: sensitivity('sensitivity').notNull().default('high'),
}, (t) => [primaryKey({ columns: [t.objectId, t.situationKey] })]);

export const objectRecipients = pgTable('object_recipients', {
  objectId: uuid('object_id').notNull(),
  userId: uuid('user_id').notNull(),
}, (t) => [primaryKey({ columns: [t.objectId, t.userId] })]);

export const sourceAlerts = pgTable('source_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  sourceId: text('source_id').notNull(),
  url: text('url'),
  fetchedAt: ts('fetched_at').notNull().defaultNow(),
  payload: jsonb('payload').notNull(),
  processedAt: ts('processed_at'),
  processError: text('process_error'),
});

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceAlertId: uuid('source_alert_id'),
  source: text('source').notNull(),
  sourceId: text('source_id').notNull(),
  msgType: text('msg_type').notNull(),
  capStatus: text('cap_status').notNull(),
  responseType: text('response_type'),
  severity: text('severity'),
  referencesIds: text('references_ids').array().notNull(),
  chainRoot: text('chain_root').notNull(),
  eventKey: text('event_key').notNull(),
  situationKey: text('situation_key'),
  sourceLevel: text('source_level').notNull(),
  level: alertLevel('level'),
  onset: ts('onset'),
  expires: ts('expires').notNull(),
  sentAt: ts('sent_at').notNull(),
  fetchedAt: ts('fetched_at').notNull().defaultNow(),
  geom: geography('geom').notNull(),
  areaNb: text('area_nb'),
  titleNb: text('title_nb'),
  titleEn: text('title_en'),
  descriptionNb: text('description_nb'),
  descriptionEn: text('description_en'),
  instructionNb: text('instruction_nb'),
  instructionEn: text('instruction_en'),
  webUrl: text('web_url'),
  supersededBy: uuid('superseded_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  alertId: uuid('alert_id').notNull(),
  objectId: uuid('object_id').notNull(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull().default('alert'),
  chainRoot: text('chain_root').notNull(),
  level: alertLevel('level').notNull(),
  channel: notifChannel('channel').notNull(),
  state: notifState('state').notNull().default('queued'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  queuedAt: ts('queued_at').notNull().defaultNow(),
  sentAt: ts('sent_at'),
  deliveredAt: ts('delivered_at'),
  ackedAt: ts('acked_at'),
  reminderSentAt: ts('reminder_sent_at'),
});

export const pushTickets = pgTable('push_tickets', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  notificationId: uuid('notification_id'),
  deviceId: uuid('device_id').notNull(),
  ticketId: text('ticket_id'),
  status: text('status').notNull(),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  checkedAt: ts('checked_at'),
  receiptStatus: text('receipt_status'),
});

export const changeProposals = pgTable('change_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull(),
  proposerId: uuid('proposer_id').notNull(),
  kind: text('kind').notNull(),
  targetId: uuid('target_id'),
  payload: jsonb('payload').notNull(),
  message: text('message'),
  status: text('status').notNull().default('pending'),
  decidedBy: uuid('decided_by'),
  decidedAt: ts('decided_at'),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  accountId: uuid('account_id'),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  at: ts('at').notNull().defaultNow(),
  metadata: jsonb('metadata').notNull(),
});

export const ingestRuns = pgTable('ingest_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  source: text('source').notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  ok: boolean('ok'),
  notModified: boolean('not_modified').notNull().default(false),
  itemsSeen: integer('items_seen').notNull().default(0),
  itemsNew: integer('items_new').notNull().default(0),
  error: text('error'),
});

export const sourceState = pgTable('source_state', {
  source: text('source').primaryKey(),
  lastModified: text('last_modified'),
  nextPollAfter: ts('next_poll_after'),
  lastSuccessAt: ts('last_success_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const smsUsage = pgTable('sms_usage', {
  accountId: uuid('account_id').notNull(),
  month: text('month').notNull(),
  count: integer('count').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.accountId, t.month] })]);

export const processedWebhooks = pgTable('processed_webhooks', {
  eventId: text('event_id').primaryKey(),
  type: text('type'),
  processedAt: ts('processed_at').notNull().defaultNow(),
});
