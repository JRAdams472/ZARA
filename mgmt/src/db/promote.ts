//! Promotion — the only code path that writes across environment
//! schemas. Runs on the `zara_promote` pool (cross-schema SELECT+INSERT,
//! no UPDATE/DELETE): copy the source env's published row VERBATIM into
//! the target schema, then write promotion_history + audit_events in the
//! target — one transaction, all-or-nothing. sha256/spec/jdm are carried
//! unchanged so the promoted graph is provably identical.

import type postgres from 'postgres';
import type { TxSql } from './pool.js';
import type { Env } from '../auth/roles.js';

// schema/table are code-controlled — safe to inline as qualified names.
const q = (tx: TxSql, schema: string, table: string) => tx.unsafe(`${schema}.${table}`);

export interface PromotionRow {
  artifactKey: string;
  artifactId: string;
  fromEnv: string;
  toEnv: string;
  graphSha256: string;
  promotedBy: string;
  promotedAt: string;
}

const TS = `to_char(promoted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** History rows in an env schema (read via zara_promote — SELECT all). */
export async function listPromotionsTx(tx: TxSql, env: Env, limit: number): Promise<PromotionRow[]> {
  const rows = await tx<
    { artifact_key: string; artifact_id: string; from_env: string; to_env: string; graph_sha256: string; promoted_by: string; promoted_at: string }[]
  >`
    SELECT artifact_key, artifact_id, from_env, to_env, graph_sha256, promoted_by,
           ${tx.unsafe(TS)} AS promoted_at
      FROM ${q(tx, `zara_${env}`, 'promotion_history')}
     ORDER BY promoted_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    artifactKey: r.artifact_key, artifactId: r.artifact_id,
    fromEnv: r.from_env, toEnv: r.to_env, graphSha256: r.graph_sha256,
    promotedBy: r.promoted_by, promotedAt: r.promoted_at,
  }));
}

export type PromoteResult =
  | { ok: true; artifactId: string; sha256: string }
  | { ok: false; reason: 'no_published' };

/** Copy the source's latest published artifact into the target env.
 *  Caller records the audit row inside the same tx. */
export async function promoteArtifactTx(
  tx: TxSql,
  input: { key: string; fromEnv: Env; toEnv: Env; promotedBy: string },
): Promise<PromoteResult> {
  const src = q(tx, `zara_${input.fromEnv}`, 'rule_artifacts');
  const dst = q(tx, `zara_${input.toEnv}`, 'rule_artifacts');
  const hist = q(tx, `zara_${input.toEnv}`, 'promotion_history');

  const source = await tx<
    { id: string; kind: string; spec: unknown; jdm: unknown; sha256: string; created_by: string }[]
  >`
    SELECT id, kind, spec, jdm, sha256, created_by FROM ${src}
     WHERE key = ${input.key} AND status = 'published'
     ORDER BY published_at DESC LIMIT 1`;
  const s = source[0];
  if (!s) return { ok: false, reason: 'no_published' };

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO ${dst}
      (tenant_id, key, kind, status, spec, jdm, sha256, created_by, published_at)
    VALUES (
      current_setting('zara.tenant_id')::uuid,
      ${input.key}, ${s.kind}, 'published',
      ${tx.json(s.spec as postgres.JSONValue)},
      ${tx.json(s.jdm as postgres.JSONValue)},
      ${s.sha256}, ${s.created_by}, now())
    RETURNING id`;
  const artifactId = inserted[0]?.id;
  if (!artifactId) throw new Error('promotion insert returned no id');

  await tx`
    INSERT INTO ${hist}
      (tenant_id, artifact_key, artifact_id, from_env, to_env, graph_sha256, promoted_by)
    VALUES (
      current_setting('zara.tenant_id')::uuid,
      ${input.key}, ${artifactId}::uuid, ${input.fromEnv}, ${input.toEnv},
      ${s.sha256}, ${input.promotedBy})`;

  return { ok: true, artifactId, sha256: s.sha256 };
}
