import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../context';
import { one } from '../db/client';
import { forbidden, unauthorized } from '../lib/errors';
import { effectiveRole, type Actor } from '../domain/permissions';
import type { AuthIdentity } from '../providers/auth';

declare module 'fastify' {
  interface FastifyRequest {
    identity?: AuthIdentity;
    actor?: Actor;
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Verifies the Supabase JWT only (claim completion and invitation acceptance). */
export function requireIdentity(ctx: Ctx) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = bearer(req);
    if (!token) throw unauthorized();
    try {
      req.identity = await ctx.providers.authVerifier.verify(token);
    } catch {
      throw unauthorized('invalid_token');
    }
  };
}

/**
 * One shared middleware: verifies the JWT, loads the caller's user row and role, and
 * rejects removed users and accounts that are deleted or not yet activated.
 */
export function requireUser(ctx: Ctx) {
  const identity = requireIdentity(ctx);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await identity(req, reply);
    const u = await one<{ id: string; account_id: string; role: 'owner' | 'member'; can_manage_objects: boolean; locale: 'nb' | 'en'; name: string; account_status: string }>(
      ctx.pool,
      `select u.id, u.account_id, u.role, u.can_manage_objects, u.locale, u.name, a.status as account_status
       from users u join accounts a on a.id = u.account_id where u.id = $1 and u.removed_at is null and a.deleted_at is null`,
      [req.identity!.sub],
    );
    if (!u) throw forbidden('not_a_member', 'no active membership for this login');
    if (u.account_status === 'pending_profile') throw forbidden('account_not_active');
    req.actor = {
      id: u.id, accountId: u.account_id, role: u.role, canManageObjects: u.can_manage_objects,
      effective: effectiveRole(u.role, u.can_manage_objects), locale: u.locale, name: u.name,
    };
  };
}
