//! Hash-chained append-only audit (MPEx audit.rs port). Advisory lock
//! serializes writers so prev_hash always points at the committed tail —
//! per-tenant chains under RLS (a documented strengthening: each tenant's
//! trail is independently tamper-evident).

import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { Sql, TxSql } from './pool.js';
import { withTenantTx } from './pool.js';

const CHAIN_LOCK = 727_001; // zara control-chain advisory lock id

// Canonical timestamp: ISO-8601 ms, always UTC. A pure function of the
// stored timestamptz — insert hashes the same string verify recomputes
// from the row, so column precision can never desync the chain.
const CANON_TS = `to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export interface AuditEvent {
  action: string;
  detail?: Record<string, unknown>;
}

export const AUDIT_ACTIONS = {
  grantPut: 'grant.put',
  grantDelete: 'grant.delete',
  authDenied: 'auth.denied',
  secretPut: 'secret.put',
  secretRewrap: 'secret.rewrap',
} as const;

function canonicalize(v: unknown): string {
  // Deterministic JSON — sorted keys at every level.
  return JSON.stringify(v, (_, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}

export function chainHash(prev: string, canonical: string): string {
  return createHash('sha256').update(`${prev}|${canonical}`).digest('hex');
}

export function canonicalEvent(e: {
  occurredAt: string;
  actorSub: string;
  action: string;
  detail: unknown;
}): string {
  return canonicalize({
    occurredAt: e.occurredAt,
    actorSub: e.actorSub,
    action: e.action,
    detail: e.detail ?? {},
  });
}

/** Append one attributed row inside the caller's tenant tx. */
export async function record(
  tx: TxSql,
  actor: { sub: string; email?: string },
  event: AuditEvent,
): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`;
  const tail = await tx<{ hash: string }[]>`
    SELECT hash FROM zara_control.audit_events ORDER BY id DESC LIMIT 1`;
  const prevHash = tail[0]?.hash ?? '';
  const occurred = await tx<{ t: string }[]>`
    SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t`;
  const occurredAt = occurred[0]?.t;
  if (!occurredAt) throw new Error('now() returned no rows');
  const detail = { ...(event.detail ?? {}) };
  if (actor.email) detail.actorEmail = actor.email;
  const hash = chainHash(
    prevHash,
    canonicalEvent({ occurredAt, actorSub: actor.sub, action: event.action, detail }),
  );
  // tenant_id comes from the same GUC RLS enforces — set by withTenantTx,
  // so the row can never be attributed to a different tenant than the tx.
  await tx`
    INSERT INTO zara_control.audit_events
      (tenant_id, occurred_at, actor_sub, action, detail, prev_hash, hash)
    VALUES (
      current_setting('zara.tenant_id')::uuid,
      ${occurredAt}::timestamptz, ${actor.sub}, ${event.action},
      ${tx.json(detail as postgres.JSONValue)}, ${prevHash}, ${hash})`;
}

export interface ChainVerify {
  checked: number;
  ok: boolean;
  firstBadId?: string;
  reason?: string;
}

/** Recompute the tenant's chain in id order — linkage + content. */
export async function verifyChain(sql: Sql, tenantId: string): Promise<ChainVerify> {
  return withTenantTx(sql, tenantId, async (tx) => {
    const rows = await tx<
      { id: number; occurred_at: string; actor_sub: string; action: string; detail: unknown; prev_hash: string; hash: string }[]
    >`SELECT id, ${tx.unsafe(CANON_TS)} AS occurred_at, actor_sub, action, detail, prev_hash, hash
        FROM zara_control.audit_events ORDER BY id`;
    let prev = '';
    for (const r of rows) {
      if (r.prev_hash !== prev) {
        return { checked: rows.length, ok: false, firstBadId: String(r.id), reason: 'link break' };
      }
      const expect = chainHash(
        prev,
        canonicalEvent({ occurredAt: r.occurred_at, actorSub: r.actor_sub, action: r.action, detail: r.detail }),
      );
      if (expect !== r.hash) {
        return { checked: rows.length, ok: false, firstBadId: String(r.id), reason: 'hash mismatch' };
      }
      prev = r.hash;
    }
    return { checked: rows.length, ok: true };
  });
}

export interface AuditRow {
  id: string;
  occurredAt: string;
  actorSub: string;
  action: string;
  detail: unknown;
}

export async function listEvents(sql: Sql, tenantId: string, limit: number): Promise<AuditRow[]> {
  return withTenantTx(sql, tenantId, async (tx) => {
    const rows = await tx<
      { id: number; occurred_at: string; actor_sub: string; action: string; detail: unknown }[]
    >`SELECT id, ${tx.unsafe(CANON_TS)} AS occurred_at, actor_sub, action, detail
        FROM zara_control.audit_events ORDER BY id DESC LIMIT ${limit}`;
    return rows.map((r) => ({
      id: String(r.id),
      occurredAt: r.occurred_at,
      actorSub: r.actor_sub,
      action: r.action,
      detail: r.detail,
    }));
  });
}
