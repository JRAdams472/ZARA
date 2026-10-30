//! Audit read surface — Release Manager: list + chain verification.

import type { FastifyInstance } from 'fastify';
import type postgres from 'postgres';
import { listEvents, verifyChain } from '../db/audit.js';
import { requireRole } from '../plugins/auth.js';

const RM = requireRole('tenant_release_manager');

export function registerAudit(app: FastifyInstance, sql: postgres.Sql): void {
  app.get('/api/admin/audit', RM, async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    return { events: await listEvents(sql, req.principal.tenantId, limit) };
  });

  app.get('/api/admin/audit/verify', RM, async (req) => {
    return verifyChain(sql, req.principal.tenantId);
  });
}
