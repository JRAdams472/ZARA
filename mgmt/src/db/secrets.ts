//! tenant_secrets access — ciphertext only. `ciphertext` never crosses
//! the route boundary: list/metadata queries omit it; the sole readers
//! are the encrypt/rewrap paths inside a tenant-scoped tx.

import type { TxSql } from './pool.js';

/** Internal row including ciphertext — db layer only. */
export interface SecretRow {
  name: string;
  ciphertext: string;
  keyName: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

const TS = `to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

interface RawRow {
  name: string;
  ciphertext?: string;
  key_name: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

function toMeta(r: RawRow): Omit<SecretRow, 'ciphertext'> {
  return {
    name: r.name,
    keyName: r.key_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

/** Metadata for every secret in the tenant — no ciphertext column. */
export async function listSecretsTx(tx: TxSql): Promise<Omit<SecretRow, 'ciphertext'>[]> {
  const rows = await tx<RawRow[]>`
    SELECT name, key_name,
           ${tx.unsafe(TS.replace('%s', 'created_at'))} AS created_at,
           ${tx.unsafe(TS.replace('%s', 'updated_at'))} AS updated_at,
           updated_by
      FROM zara_control.tenant_secrets ORDER BY name`;
  return rows.map(toMeta);
}

/** Full row incl. ciphertext — cipher paths only (rewrap/decrypt). */
export async function getSecretTx(tx: TxSql, name: string): Promise<SecretRow | undefined> {
  const rows = await tx<RawRow[]>`
    SELECT name, ciphertext, key_name,
           ${tx.unsafe(TS.replace('%s', 'created_at'))} AS created_at,
           ${tx.unsafe(TS.replace('%s', 'updated_at'))} AS updated_at,
           updated_by
      FROM zara_control.tenant_secrets WHERE name = ${name}`;
  const r = rows[0];
  return r ? { ...toMeta(r), ciphertext: r.ciphertext ?? '' } : undefined;
}

/** Envelope + key version read for the GET serializer — the version is
 *  parsed from `vault:vN:` inside the serializer; the envelope itself
 *  stays in this layer. */
export async function listSecretsWithCiphertextTx(tx: TxSql): Promise<SecretRow[]> {
  const rows = await tx<RawRow[]>`
    SELECT name, ciphertext, key_name,
           ${tx.unsafe(TS.replace('%s', 'created_at'))} AS created_at,
           ${tx.unsafe(TS.replace('%s', 'updated_at'))} AS updated_at,
           updated_by
      FROM zara_control.tenant_secrets ORDER BY name`;
  return rows.map((r) => ({ ...toMeta(r), ciphertext: r.ciphertext ?? '' }));
}

export async function upsertSecretTx(
  tx: TxSql,
  input: { name: string; ciphertext: string; keyName: string; updatedBy: string },
): Promise<void> {
  await tx`
    INSERT INTO zara_control.tenant_secrets
      (tenant_id, name, ciphertext, key_name, updated_by)
    VALUES (
      current_setting('zara.tenant_id')::uuid,
      ${input.name}, ${input.ciphertext}, ${input.keyName}, ${input.updatedBy})
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET ciphertext = EXCLUDED.ciphertext,
          key_name   = EXCLUDED.key_name,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by`;
}

/** Rewrap commits the new envelope + bumps updated_at/updated_by. */
export async function updateCiphertextTx(
  tx: TxSql,
  input: { name: string; ciphertext: string; updatedBy: string },
): Promise<boolean> {
  const rows = await tx`
    UPDATE zara_control.tenant_secrets
       SET ciphertext = ${input.ciphertext},
           updated_at = now(),
           updated_by = ${input.updatedBy}
     WHERE name = ${input.name}
    RETURNING name`;
  return rows.length > 0;
}
