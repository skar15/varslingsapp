import type { EffectiveRole, Locale } from '@varsling/shared';
import { forbidden } from '../lib/errors';

/** The authenticated caller, loaded once per request by the auth middleware. */
export interface Actor {
  id: string;
  accountId: string;
  role: 'owner' | 'member';
  canManageObjects: boolean;
  effective: EffectiveRole;
  locale: Locale;
  name: string;
}

export type Action =
  | 'view'
  | 'ack'
  | 'set_status'
  | 'manage_objects'
  | 'delete_objects'
  | 'set_normal_status'
  | 'manage_users'
  | 'delegate'
  | 'billing'
  | 'decide_object_proposals'
  | 'decide_user_proposals';

/** The permission table from the spec ("Accounts, roles and business rules"). */
export const PERMISSIONS: Record<Action, readonly EffectiveRole[]> = {
  view: ['owner', 'delegate', 'member'],
  ack: ['owner', 'delegate', 'member'],
  set_status: ['owner', 'delegate', 'member'],
  manage_objects: ['owner', 'delegate'],
  delete_objects: ['owner'],
  set_normal_status: ['owner'],
  manage_users: ['owner'],
  delegate: ['owner'],
  billing: ['owner'],
  decide_object_proposals: ['owner', 'delegate'],
  decide_user_proposals: ['owner'],
};

export function effectiveRole(role: 'owner' | 'member', canManageObjects: boolean): EffectiveRole {
  if (role === 'owner') return 'owner';
  return canManageObjects ? 'delegate' : 'member';
}

export function can(actor: Pick<Actor, 'effective'>, action: Action): boolean {
  return PERMISSIONS[action].includes(actor.effective);
}

export function assertCan(actor: Pick<Actor, 'effective'>, action: Action, code = 'forbidden'): void {
  if (!can(actor, action)) throw forbidden(code, `role ${actor.effective} may not ${action}`);
}
