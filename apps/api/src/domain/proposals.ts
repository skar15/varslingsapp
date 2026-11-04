import { schemas, type ProposalKind } from '@varsling/shared';
import type { z } from 'zod';
import type { Ctx } from '../context';
import { many, one, withTx } from '../db/client';
import { audit } from '../lib/audit';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import { iso, isoReq } from '../lib/time';
import { createObject, setSituations, updateObject } from './objects';
import { can, type Actor } from './permissions';
import { invite, removeUser } from './users';

const OBJECT_KINDS: ProposalKind[] = ['object_create', 'object_update', 'object_situations'];
const isObjectKind = (k: ProposalKind) => OBJECT_KINDS.includes(k);

/** Object proposals go to the owner or any delegate; user proposals to the owner only. */
export function canDecide(actor: Actor, kind: ProposalKind, proposerId: string): boolean {
  if (proposerId === actor.id) return false;
  return isObjectKind(kind) ? can(actor, 'decide_object_proposals') : can(actor, 'decide_user_proposals');
}

interface ProposalRow {
  id: string;
  kind: ProposalKind;
  proposer_id: string;
  proposer_name: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  note: string | null;
  created_at: Date;
}

function dto(actor: Actor, p: ProposalRow): z.infer<typeof schemas.ProposalSchema> {
  return {
    id: p.id,
    kind: p.kind,
    proposer: { id: p.proposer_id, name: p.proposer_name },
    target_id: p.target_id,
    payload: p.payload,
    message: p.message,
    status: p.status,
    decided_by: p.decided_by ? { id: p.decided_by, name: p.decided_by_name ?? '' } : null,
    decided_at: iso(p.decided_at),
    note: p.note,
    created_at: isoReq(p.created_at),
    can_decide: p.status === 'pending' && canDecide(actor, p.kind, p.proposer_id),
  };
}

const SELECT = `select p.*, pu.name as proposer_name, du.name as decided_by_name
  from change_proposals p join users pu on pu.id = p.proposer_id left join users du on du.id = p.decided_by`;

export async function listProposals(ctx: Ctx, actor: Actor) {
  const rows = await many<ProposalRow>(ctx.pool, `${SELECT} where p.account_id = $1 order by p.created_at desc limit 200`, [actor.accountId]);
  return rows
    .filter((p) => p.proposer_id === actor.id || actor.effective === 'owner' || (actor.effective === 'delegate' && isObjectKind(p.kind)))
    .map((p) => dto(actor, p));
}

export async function createProposal(ctx: Ctx, actor: Actor, input: z.infer<typeof schemas.ProposalCreate>): Promise<string> {
  if (actor.effective === 'owner') throw forbidden('owner_acts_directly', 'the owner makes changes directly');
  if (actor.effective === 'delegate' && isObjectKind(input.kind)) throw forbidden('delegate_acts_directly', 'delegates edit objects directly');
  const targetId = 'target_id' in input ? input.target_id : null;
  if (targetId) {
    const table = isObjectKind(input.kind) ? 'objects' : 'users';
    const extra = table === 'objects' ? 'deleted_at is null' : 'removed_at is null';
    const t = await one(ctx.pool, `select 1 from ${table} where id = $1 and account_id = $2 and ${extra}`, [targetId, actor.accountId]);
    if (!t) throw notFound('target');
  }
  const id = await withTx(ctx.pool, async (db) => {
    const r = await one<{ id: string }>(
      db,
      'insert into change_proposals(account_id, proposer_id, kind, target_id, payload, message) values ($1,$2,$3,$4,$5,$6) returning id',
      [actor.accountId, actor.id, input.kind, targetId, input.payload, input.message ?? null],
    );
    await audit(db, { accountId: actor.accountId, actorId: actor.id, action: 'proposal.create', targetType: 'proposal', targetId: r!.id, metadata: { kind: input.kind } });
    return r!.id;
  });
  const deciders = await many<{ id: string }>(
    ctx.pool,
    `select id from users where account_id = $1 and removed_at is null and id <> $2 and (role = 'owner' or ($3 and can_manage_objects))`,
    [actor.accountId, actor.id, isObjectKind(input.kind)],
  );
  await ctx.jobs.send('info.push', {
    userIds: deciders.map((d) => d.id), bodyKey: 'msg.proposalReceived', params: { actor: actor.name }, data: { proposal_id: id, url: 'varsling://proposals' },
  });
  return id;
}

async function loadPending(ctx: Ctx, actor: Actor, id: string): Promise<ProposalRow> {
  const p = await one<ProposalRow>(ctx.pool, `${SELECT} where p.id = $1 and p.account_id = $2`, [id, actor.accountId]);
  if (!p) throw notFound('proposal');
  if (p.status !== 'pending') throw conflict('proposal_decided');
  if (!canDecide(actor, p.kind, p.proposer_id)) throw forbidden();
  return p;
}

/** Approval applies the change through the same validated code path as a direct edit. */
export async function approveProposal(ctx: Ctx, actor: Actor, id: string, note?: string): Promise<void> {
  const p = await loadPending(ctx, actor, id);
  const claimed = await ctx.pool.query("update change_proposals set status = 'approved', decided_by = $2, decided_at = now(), note = $3 where id = $1 and status = 'pending'", [id, actor.id, note ?? null]);
  if (!claimed.rowCount) throw conflict('proposal_decided');
  try {
    switch (p.kind) {
      case 'object_create':
        await createObject(ctx, actor, schemas.ObjectCreate.parse(p.payload));
        break;
      case 'object_update':
        await updateObject(ctx, actor, p.target_id!, schemas.ObjectPatch.parse(p.payload));
        break;
      case 'object_situations':
        await setSituations(ctx, actor, p.target_id!, schemas.SituationsPut.parse(p.payload).situations);
        break;
      case 'user_invite':
        await invite(ctx, actor, schemas.InvitationCreate.parse(p.payload));
        break;
      case 'user_remove':
        await removeUser(ctx, actor, p.target_id!);
        break;
    }
  } catch (err) {
    // The change could not be applied (e.g. plan limit): the proposal stays pending.
    await ctx.pool.query("update change_proposals set status = 'pending', decided_by = null, decided_at = null, note = null where id = $1", [id]);
    if (err instanceof AppError) throw err;
    throw err;
  }
  await audit(ctx.pool, { accountId: actor.accountId, actorId: actor.id, action: 'proposal.approve', targetType: 'proposal', targetId: id });
  await notifyResult(ctx, p, 'msg.proposalResult.approved', note);
}

export async function rejectProposal(ctx: Ctx, actor: Actor, id: string, note?: string): Promise<void> {
  const p = await loadPending(ctx, actor, id);
  await ctx.pool.query("update change_proposals set status = 'rejected', decided_by = $2, decided_at = now(), note = $3 where id = $1 and status = 'pending'", [id, actor.id, note ?? null]);
  await audit(ctx.pool, { accountId: actor.accountId, actorId: actor.id, action: 'proposal.reject', targetType: 'proposal', targetId: id });
  await notifyResult(ctx, p, 'msg.proposalResult.rejected', note);
}

async function notifyResult(ctx: Ctx, p: ProposalRow, bodyKey: 'msg.proposalResult.approved' | 'msg.proposalResult.rejected', note?: string) {
  await ctx.jobs.send('info.push', {
    userIds: [p.proposer_id],
    titleKey: bodyKey,
    bodyKey: note ? 'msg.proposalNote' : bodyKey,
    params: note ? { note } : {},
    data: { proposal_id: p.id, note: note ?? null, url: 'varsling://proposals' },
  });
}
