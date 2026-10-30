//! role_grants CRUD (MPE-120 port). Mutations take the tenant-scoped tx
//! directly so a grant write and its audit row commit atomically — read-
//! only helpers keep a `withTenantTx` convenience wrapper.

import type { Sql, TxSql } from './pool.js';
import { withTenantTx } from './pool.js';

export interface GrantRow {
  id: string;
  subjectType: string;
  subject: string;
  role: string;
  grantedBy: string;
  grantedAt: string;
}

interface GrantDbRow {
  id: number;
  subject_type: string;
  subject: string;
  role: string;
  granted_by: string;
  granted_at: string;
}

const toRow = (r: GrantDbRow): GrantRow => ({
  id: String(r.id),
  subjectType: r.subject_type,
  subject: r.subject,
  role: r.role,
  grantedBy: r.granted_by,
  grantedAt: r.granted_at,
});

/** First row or throw — for queries whose shape guarantees exactly one. */
function first<T>(rows: T[]): T {
  const r = rows[0];
  if (r === undefined) throw new Error('expected exactly one row');
  return r;
}

export async function listGrantsTx(tx: TxSql): Promise<GrantRow[]> {
  const rows = await tx<GrantDbRow[]>`
    SELECT id, subject_type, subject, role, granted_by,
           granted_at::text AS granted_at
      FROM zara_control.role_grants
     ORDER BY subject_type, subject, role`;
  return rows.map(toRow);
}

export async function listGrants(sql: Sql, tenantId: string): Promise<GrantRow[]> {
  return withTenantTx(sql, tenantId, listGrantsTx);
}

/** Upsert inside the caller's tenant tx — pair with an audit `record`. */
export async function upsertGrantTx(
  tx: TxSql,
  tenantId: string,
  g: { subjectType: string; subject: string; role: string; grantedBy: string },
): Promise<GrantRow> {
  const rows = await tx<GrantDbRow[]>`
    INSERT INTO zara_control.role_grants
      (tenant_id, subject_type, subject, role, granted_by)
    VALUES (${tenantId}::uuid, ${g.subjectType}, ${g.subject}, ${g.role}, ${g.grantedBy})
    ON CONFLICT (tenant_id, subject_type, subject, role)
    DO UPDATE SET granted_by = EXCLUDED.granted_by, granted_at = now()
    RETURNING id, subject_type, subject, role, granted_by,
              granted_at::text AS granted_at`;
  return toRow(first(rows));
}

export type RevokeResult =
  | { ok: true; row: GrantRow }
  | { ok: false; reason: 'not_found' | 'last_release_manager' };

/** Revoke inside the caller's tenant tx — refuses the tenant's last
 *  release manager so a tenant can never lock itself out of admin. */
export async function revokeGrantTx(tx: TxSql, id: string): Promise<RevokeResult> {
  const rows = await tx<GrantDbRow[]>`
    DELETE FROM zara_control.role_grants
     WHERE id = ${id} AND role <> 'tenant_release_manager'
    RETURNING id, subject_type, subject, role, granted_by,
              granted_at::text AS granted_at`;
  if (rows.length === 1) return { ok: true, row: toRow(first(rows)) };

  // Either not found, or it IS a release-manager grant — check which.
  const target = await tx<{ role: string }[]>`
    SELECT role FROM zara_control.role_grants WHERE id = ${id}`;
  if (target.length === 0) return { ok: false, reason: 'not_found' };
  const rms = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM zara_control.role_grants
     WHERE role = 'tenant_release_manager'`;
  if (first(rms).n <= 1) return { ok: false, reason: 'last_release_manager' };
  const deleted = await tx<GrantDbRow[]>`
    DELETE FROM zara_control.role_grants WHERE id = ${id}
    RETURNING id, subject_type, subject, role, granted_by,
              granted_at::text AS granted_at`;
  return { ok: true, row: toRow(first(deleted)) };
}
