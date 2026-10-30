//! rule_artifacts access. Reads run on the `zara_promote` pool
//! (cross-schema SELECT); writes run on the `zara_app_dev` pool and
//! are DEV-only — drafts update in place, publishes insert the
//! immutable row. sha256 is computed IN POSTGRES over `jdm::text` so it
//! can't drift from the seed convention (`encode(sha256(jdm::text::bytea),'hex')`).

import type postgres from 'postgres';
import type { TxSql } from './pool.js';
import type { Env } from '../auth/roles.js';

export interface ArtifactMeta {
  key: string;
  kind: string;
  status: 'draft' | 'published';
  sha256: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface Artifact extends ArtifactMeta {
  spec: unknown;
  jdm: unknown;
}

interface RawRow {
  key: string;
  kind: string;
  status: 'draft' | 'published';
  sha256: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

const TS = `to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const META_COLS = `key, kind, status, sha256, created_by, ${TS.replace('%s', 'created_at')} AS created_at, ${TS.replace('%s', 'updated_at')} AS updated_at, ${TS.replace('%s', 'published_at')} AS published_at`;

// env is the typed union — safe to inline as a qualified name.
const tbl = (tx: TxSql, env: Env) => tx.unsafe(`zara_${env}.rule_artifacts`);

function toMeta(r: RawRow): ArtifactMeta {
  return {
    key: r.key, kind: r.kind, status: r.status, sha256: r.sha256,
    createdBy: r.created_by, createdAt: r.created_at,
    updatedAt: r.updated_at, publishedAt: r.published_at,
  };
}

/** List artifacts in an env schema — drafts live in dev only. */
export async function listArtifactsTx(tx: TxSql, env: Env): Promise<ArtifactMeta[]> {
  const rows = await tx<RawRow[]>`
    SELECT ${tx.unsafe(META_COLS)} FROM ${tbl(tx, env)} ORDER BY key, status DESC`;
  return rows.map(toMeta);
}

export async function getArtifactTx(tx: TxSql, env: Env, key: string): Promise<Artifact | undefined> {
  const rows = await tx<(RawRow & { spec: unknown; jdm: unknown })[]>`
    SELECT ${tx.unsafe(META_COLS)}, spec, jdm FROM ${tbl(tx, env)}
     WHERE key = ${key} ORDER BY status DESC, published_at DESC NULLS FIRST LIMIT 1`;
  const r = rows[0];
  return r ? { ...toMeta(r), spec: r.spec, jdm: r.jdm } : undefined;
}

export async function createDraftTx(
  tx: TxSql,
  input: { key: string; kind: string; spec: unknown; jdm: unknown; createdBy: string },
): Promise<void> {
  await tx`
    INSERT INTO ${tbl(tx, 'dev')}
      (tenant_id, key, kind, status, spec, jdm, sha256, created_by)
    VALUES (
      current_setting('zara.tenant_id')::uuid,
      ${input.key}, ${input.kind}, 'draft',
      ${tx.json(input.spec as postgres.JSONValue)},
      ${tx.json(input.jdm as postgres.JSONValue)},
      encode(sha256(${tx.json(input.jdm as postgres.JSONValue)}::text::bytea), 'hex'),
      ${input.createdBy})`;
}

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'published' };

async function draftOrPublished(tx: TxSql, key: string): Promise<WriteResult | undefined> {
  const draft = await tx`SELECT 1 FROM ${tbl(tx, 'dev')} WHERE key = ${key} AND status = 'draft' LIMIT 1`;
  if (draft[0]) return undefined; // draft exists — caller proceeds
  const pub = await tx`SELECT 1 FROM ${tbl(tx, 'dev')} WHERE key = ${key} AND status = 'published' LIMIT 1`;
  return { ok: false, reason: pub[0] ? 'published' : 'not_found' };
}

export async function updateDraftTx(
  tx: TxSql,
  input: { key: string; spec: unknown; jdm: unknown },
): Promise<WriteResult> {
  const check = await draftOrPublished(tx, input.key);
  if (check) return check;
  await tx`
    UPDATE ${tbl(tx, 'dev')}
       SET spec = ${tx.json(input.spec as postgres.JSONValue)},
           jdm = ${tx.json(input.jdm as postgres.JSONValue)},
           sha256 = encode(sha256(${tx.json(input.jdm as postgres.JSONValue)}::text::bytea), 'hex'),
           updated_at = now()
     WHERE key = ${input.key} AND status = 'draft'`;
  return { ok: true };
}

export async function deleteDraftTx(tx: TxSql, key: string): Promise<WriteResult> {
  const check = await draftOrPublished(tx, key);
  if (check) return check;
  await tx`DELETE FROM ${tbl(tx, 'dev')} WHERE key = ${key} AND status = 'draft'`;
  return { ok: true };
}

/** Draft → immutable published row in dev (draft itself stays as the
 *  working copy). Returns the published row's sha for the response. */
export async function publishDraftTx(
  tx: TxSql,
  key: string,
): Promise<{ ok: true; sha256: string } | { ok: false; reason: 'not_found' }> {
  const rows = await tx<{ sha256: string }[]>`
    INSERT INTO ${tbl(tx, 'dev')}
      (tenant_id, key, kind, status, spec, jdm, sha256, created_by, published_at)
    SELECT tenant_id, key, kind, 'published', spec, jdm, sha256, created_by, now()
      FROM ${tbl(tx, 'dev')} WHERE key = ${key} AND status = 'draft'
    RETURNING sha256`;
  const r = rows[0];
  return r ? { ok: true, sha256: r.sha256 } : { ok: false, reason: 'not_found' };
}
