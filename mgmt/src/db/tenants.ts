import type { Sql } from './pool.js';

/** Slug → tenant UUID via the registry (active tenants only). */
export async function tenantIdForSlug(sql: Sql, slug: string): Promise<string | undefined> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM zara_control.tenants WHERE slug = ${slug} AND status = 'active'`;
  return rows[0]?.id;
}
