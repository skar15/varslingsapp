/**
 * Request and response contracts for the /v1 API. The OpenAPI document is generated
 * from these schemas, and the api-client is generated from that document.
 */
import { z } from 'zod';
import {
  ACCOUNT_KINDS, ACCOUNT_STATUSES, ALERT_LEVELS, LIGHTS, LOCALES, LOCATION_KINDS, NOTIF_CHANNELS, NOTIF_KINDS,
  NOTIF_STATES, PROPOSAL_KINDS, PROPOSAL_STATUSES, SENSITIVITIES, USER_ROLES,
} from './enums';

export const Id = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const LocaleSchema = z.enum(LOCALES);
export const AlertLevelSchema = z.enum(ALERT_LEVELS);
export const LightSchema = z.enum(LIGHTS);
export const SensitivitySchema = z.enum(SENSITIVITIES);
export const I18nText = z.object({ nb: z.string(), en: z.string().optional() });

/** Norwegian mobile numbers only at launch (+47 and 8 digits). */
export const PhoneE164 = z.string().regex(/^\+47\d{8}$/, 'Only +47 numbers are supported');
export const OrgNumber = z.string().regex(/^\d{9}$/);

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;

export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ---------------------------------------------------------------- geometry
const Lon = z.number().min(-180).max(180);
const Lat = z.number().min(-90).max(90);
export const PositionSchema = z.tuple([Lon, Lat]);
export const PointSchema = z.object({ type: z.literal('Point'), coordinates: PositionSchema });
export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(PositionSchema).min(4).max(200)).min(1).max(1),
});
export const MultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(PositionSchema).min(4)).min(1)).min(1),
});
export const ObjectGeometrySchema = z.discriminatedUnion('type', [PointSchema, PolygonSchema]);

export const LocationInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('point'), geometry: PointSchema, place_label: z.string().max(200).nullish() }),
  z.object({ kind: z.literal('area'), geometry: PolygonSchema, place_label: z.string().max(200).nullish() }),
]);
export type LocationInput = z.infer<typeof LocationInput>;

// ---------------------------------------------------------------- plans and billing
export const Plan = z.object({
  key: z.string(),
  name: I18nText,
  max_users: z.number().int(),
  max_objects: z.number().int(),
  sms_monthly_cap: z.number().int(),
  purchasable: z.boolean(),
});
export type Plan = z.infer<typeof Plan>;
export const PlanList = z.object({ items: z.array(Plan) });

export const CheckoutSessionRequest = z.object({ plan_key: z.string().min(1), locale: LocaleSchema.optional() });
export const CheckoutSessionResponse = z.object({ url: z.url() });
export const PortalSessionResponse = z.object({ url: z.url() });

// ---------------------------------------------------------------- claim and registration
export const ClaimInfo = z.object({
  account_id: Id,
  plan: Plan,
  email: z.string().nullable(),
  expires_at: IsoDateTime,
});
export const ClaimComplete = z
  .object({
    kind: z.enum(ACCOUNT_KINDS),
    legal_name: z.string().trim().min(1).max(200).optional(),
    org_number: OrgNumber.optional(),
    owner_name: z.string().trim().min(1).max(120),
    locale: LocaleSchema.default('nb'),
    accept_terms: z.literal(true),
    confirm_adult: z.literal(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== 'person' && !v.org_number) ctx.addIssue({ code: 'custom', path: ['org_number'], message: 'required' });
    if (v.kind !== 'person' && !v.legal_name) ctx.addIssue({ code: 'custom', path: ['legal_name'], message: 'required' });
  });
export type ClaimComplete = z.infer<typeof ClaimComplete>;

// ---------------------------------------------------------------- me, account, users
export const EffectiveRoleSchema = z.enum(['owner', 'delegate', 'member']);
export const PlanLimits = z.object({ max_users: z.number().int(), max_objects: z.number().int(), sms_monthly_cap: z.number().int() });

export const UserSchema = z.object({
  id: Id,
  name: z.string(),
  email: z.string().nullable(),
  phone_e164: z.string().nullable(),
  phone_verified: z.boolean(),
  role: z.enum(USER_ROLES),
  can_manage_objects: z.boolean(),
  effective_role: EffectiveRoleSchema,
  locale: LocaleSchema,
  created_at: IsoDateTime,
});
export type UserDto = z.infer<typeof UserSchema>;

export const AccountSchema = z.object({
  id: Id,
  kind: z.enum(ACCOUNT_KINDS),
  legal_name: z.string().nullable(),
  org_number: z.string().nullable(),
  status: z.enum(ACCOUNT_STATUSES),
  alerts_paused: z.boolean(),
  plan: Plan.nullable(),
  usage: z.object({
    users: z.number().int(),
    pending_invitations: z.number().int(),
    objects: z.number().int(),
    sms_this_month: z.number().int(),
  }),
});
export type AccountDto = z.infer<typeof AccountSchema>;

export const MeSchema = z.object({
  user: UserSchema.extend({ sms_for_all_levels: z.boolean() }),
  account: AccountSchema,
  limits: PlanLimits.nullable(),
});
export type MeDto = z.infer<typeof MeSchema>;

export const MePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  locale: LocaleSchema.optional(),
  sms_for_all_levels: z.boolean().optional(),
});

export const DeviceRegister = z.object({
  platform: z.enum(['ios', 'android']),
  push_token: z.string().min(10).max(300),
  app_version: z.string().max(40).optional(),
});
export const DeviceRegistered = z.object({ id: Id });

export const UserList = z.object({
  items: z.array(UserSchema),
  invitations: z.array(
    z.object({ id: Id, channel: z.enum(['email', 'sms']), target: z.string(), name: z.string().nullable(), expires_at: IsoDateTime }),
  ),
  can_invite: z.boolean(),
  max_users: z.number().int(),
});

export const InvitationCreate = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('email'), email: z.email().max(200), name: z.string().max(120).optional() }),
  z.object({ channel: z.literal('sms'), phone_e164: PhoneE164, name: z.string().max(120).optional() }),
]);
export type InvitationCreate = z.infer<typeof InvitationCreate>;
export const InvitationCreated = z.object({ id: Id, expires_at: IsoDateTime });
export const InvitationAccept = z.object({ name: z.string().trim().min(1).max(120), locale: LocaleSchema.default('nb') });
export const RightsPatch = z.object({ can_manage_objects: z.boolean() });

// ---------------------------------------------------------------- reference data
export const SituationTypeRef = z.object({ key: z.string(), i18n: I18nText, available: z.boolean(), sort: z.number().int() });
export const ObjectTypeRef = z.object({
  key: z.string(), i18n: I18nText, defaults: z.array(z.string()), category: z.string(), icon: z.string(), sort: z.number().int(),
});
export const ObjectStatusRef = z.object({
  key: z.string(), i18n: I18nText, adds: z.array(z.string()), removes: z.array(z.string()),
  applies_to: z.array(z.string()).nullable(), sort: z.number().int(),
});
export const ReferenceData = z.object({
  situation_types: z.array(SituationTypeRef),
  object_types: z.array(ObjectTypeRef),
  object_statuses: z.array(ObjectStatusRef),
  config: z.object({ max_area_km2: z.number(), light_horizon_hours: z.number(), max_drawn_corners: z.number().int() }),
});
export type ReferenceData = z.infer<typeof ReferenceData>;

// ---------------------------------------------------------------- objects
export const SituationSetting = z.object({ situation_key: z.string().min(1).max(40), sensitivity: SensitivitySchema });
export const MonitoredSituationSchema = z.object({
  key: z.string(),
  sensitivity: SensitivitySchema,
  effective_sensitivity: SensitivitySchema,
  added_by_status: z.boolean(),
});

export const AlertSummary = z.object({
  id: Id,
  source: z.string(),
  msg_type: z.enum(['alert', 'update', 'cancel']),
  event_key: z.string(),
  situation_key: z.string().nullable(),
  level: AlertLevelSchema.nullable(),
  source_level: z.string(),
  onset: IsoDateTime.nullable(),
  expires: IsoDateTime,
  title: z.string().nullable(),
  superseded: z.boolean(),
});
export type AlertSummaryDto = z.infer<typeof AlertSummary>;

export const ObjectSummary = z.object({
  id: Id,
  nickname: z.string().nullable(),
  display_name: z.string(),
  type_key: z.string().nullable(),
  status_key: z.string(),
  normal_status_key: z.string(),
  status_until: IsoDateTime.nullable(),
  status_set_by: z.object({ id: Id, name: z.string() }).nullable(),
  location_kind: z.enum(LOCATION_KINDS),
  geometry: ObjectGeometrySchema.nullable(),
  place_label: z.string().nullable(),
  municipality_no: z.string().nullable(),
  light: LightSchema,
  summary: z
    .object({ level: AlertLevelSchema, situation_key: z.string().nullable(), onset: IsoDateTime.nullable(), expires: IsoDateTime, title: z.string().nullable(), alert_id: Id })
    .nullable(),
  monitored: z.array(MonitoredSituationSchema),
});
export type ObjectSummaryDto = z.infer<typeof ObjectSummary>;

export const ObjectList = z.object({
  items: z.array(ObjectSummary),
  generated_at: IsoDateTime,
  sources: z.array(z.object({ source: z.string(), last_success_at: IsoDateTime.nullable(), stale: z.boolean() })),
});

export const ObjectDetail = ObjectSummary.extend({
  situations: z.array(SituationSetting),
  alerts: z.array(AlertSummary),
  can_edit: z.boolean(),
  can_delete: z.boolean(),
  can_set_normal: z.boolean(),
});
export type ObjectDetailDto = z.infer<typeof ObjectDetail>;

export const ObjectCreate = z.object({
  nickname: z.string().trim().max(80).nullish(),
  type_key: z.string().max(40).nullish(),
  location: LocationInput.default({ kind: 'none' }),
  status_key: z.string().max(40).optional(),
  status_until: IsoDateTime.optional(),
  situations: z.array(SituationSetting).max(30).optional(),
});
export type ObjectCreate = z.infer<typeof ObjectCreate>;

export const ObjectPatch = z.object({
  nickname: z.string().trim().max(80).nullish(),
  type_key: z.string().max(40).nullish(),
  location: LocationInput.optional(),
});
export type ObjectPatch = z.infer<typeof ObjectPatch>;

export const SituationsPut = z.object({ situations: z.array(SituationSetting).max(30) });
export type SituationsPut = z.infer<typeof SituationsPut>;
export const StatusPut = z.object({ status_key: z.string().min(1).max(40), until: IsoDateTime.optional() });
export const StatusExtend = z.object({ until: IsoDateTime });
export const NormalStatusPut = z.object({ status_key: z.string().min(1).max(40) });

// ---------------------------------------------------------------- geo
export const GeoSearchQuery = z.object({ q: z.string().trim().min(2).max(120) });
export const GeoResult = z.object({
  label: z.string(),
  kind: z.enum(['address', 'place']),
  lat: z.number(),
  lon: z.number(),
  municipality_no: z.string().nullable(),
});
export const GeoSearchResponse = z.object({ items: z.array(GeoResult) });
export const GeoReverseQuery = z.object({ lat: z.coerce.number().min(57).max(81.5), lon: z.coerce.number().min(-9.5).max(34) });
export const GeoReverseResponse = z.object({ label: z.string().nullable(), municipality_no: z.string().nullable(), county_no: z.string().nullable() });

// ---------------------------------------------------------------- alerts and notifications
export const AlertDetail = AlertSummary.extend({
  issuer: z.string(),
  description: z.string().nullable(),
  instruction: z.string().nullable(),
  web_url: z.string().nullable(),
  geometry: MultiPolygonSchema,
  fetched_at: IsoDateTime,
  sent_at: IsoDateTime,
  objects: z.array(z.object({ id: Id, display_name: z.string(), advice: z.array(z.string()) })),
  notification: z.object({ id: Id, acked_at: IsoDateTime.nullable(), level: AlertLevelSchema }).nullable(),
});
export type AlertDetailDto = z.infer<typeof AlertDetail>;
export const AlertListQuery = CursorQuery.extend({ object_id: Id.optional(), include_past: z.coerce.boolean().default(false) });
export const AlertList = z.object({ items: z.array(AlertSummary.extend({ object_ids: z.array(Id) })), next_cursor: z.string().nullable() });

export const NotificationSchema = z.object({
  id: Id,
  alert_id: Id,
  object_id: Id,
  kind: z.enum(NOTIF_KINDS),
  level: AlertLevelSchema,
  channel: z.enum(NOTIF_CHANNELS),
  state: z.enum(NOTIF_STATES),
  queued_at: IsoDateTime,
  sent_at: IsoDateTime.nullable(),
  acked_at: IsoDateTime.nullable(),
});
export const NotificationList = z.object({ items: z.array(NotificationSchema), next_cursor: z.string().nullable() });
export const AckResponse = z.object({ acked_at: IsoDateTime });

// ---------------------------------------------------------------- proposals
export const ProposalPayloads = {
  object_create: ObjectCreate,
  object_update: ObjectPatch,
  object_situations: SituationsPut,
  user_invite: InvitationCreate,
  user_remove: z.object({}),
} as const;

export const ProposalCreate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('object_create'), payload: ObjectCreate, message: z.string().max(500).optional() }),
  z.object({ kind: z.literal('object_update'), target_id: Id, payload: ObjectPatch, message: z.string().max(500).optional() }),
  z.object({ kind: z.literal('object_situations'), target_id: Id, payload: SituationsPut, message: z.string().max(500).optional() }),
  z.object({ kind: z.literal('user_invite'), payload: InvitationCreate, message: z.string().max(500).optional() }),
  z.object({ kind: z.literal('user_remove'), target_id: Id, payload: z.object({}).default({}), message: z.string().max(500).optional() }),
]);
export type ProposalCreate = z.infer<typeof ProposalCreate>;

export const ProposalSchema = z.object({
  id: Id,
  kind: z.enum(PROPOSAL_KINDS),
  proposer: z.object({ id: Id, name: z.string() }),
  target_id: Id.nullable(),
  payload: z.record(z.string(), z.unknown()),
  message: z.string().nullable(),
  status: z.enum(PROPOSAL_STATUSES),
  decided_by: z.object({ id: Id, name: z.string() }).nullable(),
  decided_at: IsoDateTime.nullable(),
  note: z.string().nullable(),
  created_at: IsoDateTime,
  can_decide: z.boolean(),
});
export const ProposalList = z.object({ items: z.array(ProposalSchema) });
export const ProposalDecision = z.object({ note: z.string().max(500).optional() });

// ---------------------------------------------------------------- admin and health
export const SimulateAlert = z.object({
  geometry: z.discriminatedUnion('type', [PolygonSchema, MultiPolygonSchema]),
  event: z.string().min(1).max(40),
  source_level: z.enum(['yellow', 'orange', 'red']),
  msg_type: z.enum(['Alert', 'Update', 'Cancel']).default('Alert'),
  references: z.array(z.string()).default([]),
  response_type: z.enum(['Monitor', 'Prepare', 'AllClear', 'None']).optional(),
  onset: IsoDateTime.optional(),
  expires: IsoDateTime.optional(),
  headline: z.string().max(200).optional(),
});
export type SimulateAlert = z.infer<typeof SimulateAlert>;
export const SimulateAlertResponse = z.object({ source_id: z.string(), reference: z.string(), alert_id: Id.nullable() });

export const Health = z.object({ ok: z.boolean(), version: z.string(), time: IsoDateTime });
export const IngestHealth = z.object({
  ok: z.boolean(),
  sources: z.array(
    z.object({
      source: z.string(),
      last_success_at: IsoDateTime.nullable(),
      age_seconds: z.number().nullable(),
      stale: z.boolean(),
      last_error: z.string().nullable(),
    }),
  ),
});
