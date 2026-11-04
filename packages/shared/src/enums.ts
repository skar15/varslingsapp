export const ALERT_LEVELS = ['green', 'yellow', 'red'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** Dashboard light. `none` is the white light. */
export const LIGHTS = ['none', 'green', 'yellow', 'red'] as const;
export type Light = (typeof LIGHTS)[number];

export const SENSITIVITIES = ['low', 'medium', 'high'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const ACCOUNT_KINDS = ['person', 'company', 'public_body'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_STATUSES = ['pending_profile', 'active', 'past_due', 'canceled', 'deleted'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const USER_ROLES = ['owner', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Effective role used by permission checks. A delegate is a member with can_manage_objects. */
export type EffectiveRole = 'owner' | 'delegate' | 'member';

export const LOCATION_KINDS = ['none', 'point', 'area'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const NOTIF_CHANNELS = ['push', 'sms'] as const;
export type NotifChannel = (typeof NOTIF_CHANNELS)[number];

export const NOTIF_STATES = ['queued', 'sent', 'delivered', 'failed', 'acked', 'suppressed'] as const;
export type NotifState = (typeof NOTIF_STATES)[number];

export const NOTIF_KINDS = ['alert', 'cancel'] as const;
export type NotifKind = (typeof NOTIF_KINDS)[number];

export const LOCALES = ['nb', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const PROPOSAL_KINDS = ['object_create', 'object_update', 'object_situations', 'user_invite', 'user_remove'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const ALERT_SOURCES = ['met', 'nve-flood', 'nve-landslide', 'sim'] as const;
export type AlertSourceKey = (typeof ALERT_SOURCES)[number];
