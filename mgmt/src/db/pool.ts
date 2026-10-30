//! postgres.js pool + the tenant-GUC transaction helper. Every control-
//! schema read/write runs inside `withTenantTx`, which stamps
//! `set_config('zara.tenant_id', $1, true)` first — FORCE RLS means no GUC
//! = zero rows. There is no unscoped path.

import postgres from 'postgres';

export type Sql = postgres.Sql;
export type TxSql = postgres.TransactionSql;

export function createPool(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 8 });
}

/** Run `fn` inside a transaction scoped to `tenantId` by the RLS GUC. */
export async function withTenantTx<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: TxSql) => Promise<T>,
): Promise<T> {
  const out = await sql.begin(async (tx) => {
    await tx`SELECT set_config('zara.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
  return out as T;
}
