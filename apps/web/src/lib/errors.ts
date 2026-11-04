import { isI18nKey, type I18nKey } from '@varsling/shared';
import { ApiError } from '@varsling/api-client';

/** Maps an API problem to an i18n key where one exists. */
export function errorKey(err: unknown): I18nKey {
  if (err instanceof ApiError) {
    const k = err.problem.i18n_key;
    if (typeof k === 'string' && isI18nKey(k)) return k;
    if (err.code === 'plan_limit_objects') return 'object.limitReached';
    if (err.code === 'proposal_required') return 'object.proposalSent';
    if (err.code === 'situations_required') return 'object.situations.mustChoose';
  }
  return 'common.error';
}
