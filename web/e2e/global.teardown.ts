import { request } from '@playwright/test';
import { existsSync } from 'node:fs';

/** Global teardown (MPE-175): sweep synthetic e2e artifacts out of the
 *  shared demo DB. Draft `e2e.*` rules are deleted; published copies are
 *  immutable by design (append-only invariant) and stay — the `e2e.`
 *  keyspace is unambiguous synthetic namespace. `e2e-subject-*` grants
 *  are revoked. Best-effort: teardown never fails the suite — an
 *  unreachable stack or missing storage state just skips the sweep. */
export default async function globalTeardown() {
  const base = process.env.E2E_BASE_URL ?? 'http://localhost:3400';
  const state = 'e2e/.auth/rm.json';
  if (!existsSync(state)) {
    console.warn('[teardown] no RM storage state — skipping synthetic sweep');
    return;
  }
  const ctx = await request.newContext({ baseURL: base, storageState: state });
  try {
    const rulesRes = await ctx.get('/bff/api/envs/dev/rules');
    if (rulesRes.ok()) {
      const { rules } = (await rulesRes.json()) as {
        rules: { key: string; status: string }[];
      };
      const drafts = rules.filter((r) => r.key.startsWith('e2e.') && r.status === 'draft');
      for (const r of drafts) {
        await ctx.delete(`/bff/api/envs/dev/rules/${encodeURIComponent(r.key)}`);
      }
      console.log(`[teardown] deleted ${drafts.length} e2e.* draft(s)`);
    }

    const grantsRes = await ctx.get('/bff/api/admin/grants');
    if (grantsRes.ok()) {
      const { grants } = (await grantsRes.json()) as {
        grants: { id: string; subject: string }[];
      };
      const strays = grants.filter((g) => g.subject.startsWith('e2e-subject-'));
      for (const g of strays) {
        await ctx.delete(`/bff/api/admin/grants/${encodeURIComponent(g.id)}`);
      }
      console.log(`[teardown] revoked ${strays.length} e2e-subject-* grant(s)`);
    }
  } catch (e) {
    console.warn(`[teardown] sweep failed (best-effort): ${e}`);
  } finally {
    await ctx.dispose();
  }
}
