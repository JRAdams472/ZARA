//! Grants admin (MPE-120 port) — Release Manager only; every write lands
//! an audit chain row in the same tenant transaction, so a mutation and
//! its attestation commit or roll back together.

import type { FastifyInstance } from 'fastify';
import type postgres from 'postgres';
import { isRole, ROLES } from '../auth/roles.js';
import { listGrants, revokeGrantTx, upsertGrantTx } from '../db/grants.js';
import { record, AUDIT_ACTIONS } from '../db/audit.js';
import { withTenantTx } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../plugins/errors.js';
import { requireRole } from '../plugins/auth.js';

const RM = requireRole('tenant_release_manager');
const SUBJECT_TYPES = ['sub', 'email', 'aud'] as const;

const putSchema = {
  body: {
    type: 'object',
    required: ['subjectType', 'subject', 'role'],
    additionalProperties: false,
    properties: {
      subjectType: { type: 'string', enum: SUBJECT_TYPES },
      subject: { type: 'string', minLength: 1, maxLength: 256 },
      role: { type: 'string', enum: ROLES },
    },
  },
} as const;

export function registerGrants(app: FastifyInstance, sql: postgres.Sql): void {
  app.get('/api/admin/grants', RM, async (req) => {
    return { grants: await listGrants(sql, req.principal.tenantId) };
  });

  app.put('/api/admin/grants', { ...RM, schema: putSchema }, async (req, reply) => {
    const body = req.body as { subjectType: string; subject: string; role: string };
    if (!SUBJECT_TYPES.includes(body.subjectType as (typeof SUBJECT_TYPES)[number])) {
      throw badRequest('invalid subjectType');
    }
    if (!isRole(body.role)) throw badRequest('invalid role');
    const p = req.principal;
    const grant = await withTenantTx(sql, p.tenantId, async (tx) => {
      const g = await upsertGrantTx(tx, p.tenantId, {
        subjectType: body.subjectType,
        subject: body.subject,
        role: body.role,
        grantedBy: p.sub,
      });
      await record(tx, p, {
        action: AUDIT_ACTIONS.grantPut,
        detail: { subjectType: body.subjectType, subject: body.subject, role: body.role },
      });
      return g;
    });
    return reply.code(200).send({ grant });
  });

  app.delete('/api/admin/grants/:id', RM, async (req) => {
    const { id } = req.params as { id: string };
    if (!/^\d+$/.test(id)) throw badRequest('invalid id');
    const p = req.principal;
    const result = await withTenantTx(sql, p.tenantId, async (tx) => {
      const r = await revokeGrantTx(tx, id);
      if (r.ok) {
        await record(tx, p, {
          action: AUDIT_ACTIONS.grantDelete,
          detail: { id, subject: r.row.subject, role: r.row.role },
        });
      }
      return r;
    });
    if (!result.ok) {
      if (result.reason === 'not_found') throw notFound('grant not found');
      throw forbidden("refusing to revoke the tenant's last release manager");
    }
    return { revoked: result.row };
  });
}
