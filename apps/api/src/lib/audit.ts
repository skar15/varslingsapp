import type { Db } from '../db/client';

/** Written for every change to users, objects, statuses and plans. Ids only, no personal data. */
export async function audit(
  db: Db,
  e: { accountId: string | null; actorId: string | null; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.query('insert into audit_log(account_id, actor_id, action, target_type, target_id, metadata) values ($1,$2,$3,$4,$5,$6)', [
    e.accountId, e.actorId, e.action, e.targetType ?? null, e.targetId ?? null, e.metadata ?? {},
  ]);
}
