//! Promotion route — unskippable by construction: the source env is the
//! path param and the target is DERIVED (dev→qa→uat→prod), so DEV→PROD
//! cannot be expressed. `zara_promote` (SELECT+INSERT, no UPDATE/DELETE)
//! copies the published row verbatim + promotion_history + env audit in
//! one tx. RBAC: engineer promotes →UAT only; RM sign-off →PROD.

import type { FastifyInstance } from 'fastify';
import type { Sql } from '../db/pool.js';
import { canPromote, nextEnv, parseEnv } from '../auth/roles.js';
import { AUDIT_ACTIONS, record } from '../db/audit.js';
import { listPromotionsTx, promoteArtifactTx } from '../db/promote.js';
import { RULE_KEY_RE } from '../rules/jdm.js';
import { badRequest, forbidden, HttpError, notFound } from '../plugins/errors.js';
import { withTenantTx } from '../db/pool.js';

function needPool(sql: Sql | undefined): Sql {
  if (!sql) throw new HttpError(503, 'promotion store not configured');
  return sql;
}

export function registerPromote(
  app: FastifyInstance,
  promoteSql: Sql | undefined,
  auditSql: Sql,
): void {
  app.post('/api/envs/:env/rules/:key/promote', async (req) => {
    const { env: envParam, key } = req.params as { env: string; key: string };
    const fromEnv = parseEnv(envParam);
    if (!fromEnv) throw badRequest('unknown environment');
    const toEnv = nextEnv(fromEnv);
    if (!toEnv) throw badRequest('prod has no successor environment');
    if (!RULE_KEY_RE.test(key)) throw badRequest('invalid rule key');
    const p = req.principal;
    if (!canPromote(p.roles, toEnv)) {
      try {
        await withTenantTx(auditSql, p.tenantId, (tx) =>
          record(tx, p, {
            action: AUDIT_ACTIONS.authDenied,
            detail: { method: req.method, path: req.url, reason: `promotion to ${toEnv} not in role scope` },
          }),
        );
      } catch (e) {
        app.log.error({ err: e }, 'auth.denied audit write failed');
      }
      throw forbidden(`promotion to ${toEnv} not in role scope`);
    }
    const sql = needPool(promoteSql);
    const result = await withTenantTx(sql, p.tenantId, async (tx) => {
      const r = await promoteArtifactTx(tx, { key, fromEnv, toEnv, promotedBy: p.sub });
      if (r.ok) {
        await record(
          tx,
          p,
          {
            action: AUDIT_ACTIONS.promoteRule,
            detail: { key, fromEnv, toEnv, sha256: r.sha256, artifactId: r.artifactId },
          },
          `zara_${toEnv}`,
        );
      }
      return r;
    });
    if (!result.ok) throw notFound('no published artifact for key in source env');
    try {
      await withTenantTx(auditSql, p.tenantId, (tx) =>
        record(tx, p, {
          action: AUDIT_ACTIONS.promoteRule,
          detail: { key, fromEnv, toEnv, sha256: result.sha256 },
        }),
      );
    } catch (e) {
      app.log.error({ err: e }, 'control audit write failed');
    }
    return { key, fromEnv, toEnv, artifactId: result.artifactId, sha256: result.sha256 };
  });

  app.get('/api/envs/:env/promotions', async (req) => {
    const env = parseEnv((req.params as { env: string }).env);
    if (!env) throw badRequest('unknown environment');
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50) || 50, 200);
    const p = req.principal;
    const rows = await withTenantTx(needPool(promoteSql), p.tenantId, (tx) =>
      listPromotionsTx(tx, env, limit),
    );
    return { promotions: rows };
  });
}
