//! Rule lifecycle routes — reads cross-env via `zara_promote` (SELECT
//! everywhere), mutations DEV-only via `zara_app_dev`. spec IS the JDM
//! document (validate+canonicalize at write); sha256 is computed in
//! Postgres over jdm::text. Every mutation writes an env-schema audit
//! row inside the SAME transaction, plus a control-chain row after.

import type { FastifyInstance } from 'fastify';
import type { Sql } from '../db/pool.js';
import { accessIn, parseEnv, type Role } from '../auth/roles.js';
import { AUDIT_ACTIONS, record } from '../db/audit.js';
import {
  createDraftTx,
  deleteDraftTx,
  draftExistsTx,
  getArtifactTx,
  listArtifactsTx,
  publishDraftTx,
  updateDraftTx,
  type WriteResult,
} from '../db/rules.js';
import { assertJdmShape, canonicalize, isRuleKind, RULE_KEY_RE } from '../rules/jdm.js';
import { assertNoPii } from '../rules/pii.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../plugins/errors.js';
import { withTenantTx } from '../db/pool.js';

const writeSchema = {
  body: {
    type: 'object',
    required: ['spec'],
    additionalProperties: false,
    properties: {
      spec: { type: 'object' },
      kind: { type: 'string' },
      key: { type: 'string' },
    },
  },
} as const;

function needPool(sql: Sql | undefined): Sql {
  if (!sql) throw new HttpError(503, 'rules store not configured');
  return sql;
}

function writeDenied(ok: WriteResult): void {
  if (ok.ok) return;
  if (ok.reason === 'published') throw forbidden('published artifacts are immutable');
  throw notFound('artifact not found');
}

export function registerRules(
  app: FastifyInstance,
  rulesSql: Sql | undefined,
  promoteSql: Sql | undefined,
  auditSql: Sql,
): void {
  const canWriteDev = (roles: readonly Role[]) => accessIn(roles, 'dev') === 'write';

  app.get('/api/envs/:env/rules', async (req) => {
    const env = parseEnv((req.params as { env: string }).env) ?? fail400();
    const p = req.principal;
    const rows = await withTenantTx(needPool(promoteSql), p.tenantId, (tx) =>
      listArtifactsTx(tx, env),
    );
    return { rules: rows };
  });

  app.get('/api/envs/:env/rules/:key', async (req) => {
    const { env: envParam, key } = req.params as { env: string; key: string };
    const env = parseEnv(envParam) ?? fail400();
    if (!RULE_KEY_RE.test(key)) throw badRequest('invalid rule key');
    const p = req.principal;
    const row = await withTenantTx(needPool(promoteSql), p.tenantId, (tx) =>
      getArtifactTx(tx, env, key),
    );
    if (!row) throw notFound('artifact not found');
    return { rule: row };
  });

  app.post('/api/envs/:env/rules', { schema: writeSchema }, async (req, reply) => {
    const env = parseEnv((req.params as { env: string }).env) ?? fail400();
    if (env !== 'dev') throw badRequest('rule mutations are DEV-only');
    const p = req.principal;
    if (!canWriteDev(p.roles)) throw forbidden('dev write required');
    const body = req.body as { key?: string; kind?: string; spec: unknown };
    if (!body.key || !RULE_KEY_RE.test(body.key)) throw badRequest('invalid rule key');
    if (!body.kind || !isRuleKind(body.kind)) throw badRequest('invalid kind');
    assertJdmShape(body.spec);
    assertNoPii(body.spec);
    const jdm = JSON.parse(canonicalize(body.spec)) as unknown;
    const key = body.key;
    const kind = body.kind;
    await withTenantTx(needPool(rulesSql), p.tenantId, async (tx) => {
      // One draft per (tenant,key) — a live draft means continue editing
      // it; a published-only key is the "new draft from published" path.
      if (await draftExistsTx(tx, key)) throw conflict('a draft with this key already exists');
      await createDraftTx(tx, { key, kind, spec: body.spec, jdm, createdBy: p.sub });
      await record(tx, p, { action: AUDIT_ACTIONS.ruleCreate, detail: { key: body.key, kind: body.kind } }, 'zara_dev');
    });
    await controlAudit(auditSql, p, AUDIT_ACTIONS.ruleCreate, { key: body.key, kind: body.kind });
    return reply.code(201).send({ key: body.key });
  });

  app.put('/api/envs/:env/rules/:key', { schema: writeSchema }, async (req) => {
    const env = parseEnv((req.params as { env: string }).env) ?? fail400();
    if (env !== 'dev') throw badRequest('rule mutations are DEV-only');
    const { key } = req.params as { key: string };
    const p = req.principal;
    if (!canWriteDev(p.roles)) throw forbidden('dev write required');
    const { spec } = req.body as { spec: unknown };
    assertJdmShape(spec);
    assertNoPii(spec);
    const jdm = JSON.parse(canonicalize(spec)) as unknown;
    const result = await withTenantTx(needPool(rulesSql), p.tenantId, async (tx) => {
      const r = await updateDraftTx(tx, { key, spec, jdm });
      if (r.ok) await record(tx, p, { action: AUDIT_ACTIONS.ruleUpdate, detail: { key } }, 'zara_dev');
      return r;
    });
    writeDenied(result);
    await controlAudit(auditSql, p, AUDIT_ACTIONS.ruleUpdate, { key });
    return { key };
  });

  app.delete('/api/envs/:env/rules/:key', async (req) => {
    const env = parseEnv((req.params as { env: string }).env) ?? fail400();
    if (env !== 'dev') throw badRequest('rule mutations are DEV-only');
    const { key } = req.params as { key: string };
    const p = req.principal;
    if (!canWriteDev(p.roles)) throw forbidden('dev write required');
    const result = await withTenantTx(needPool(rulesSql), p.tenantId, async (tx) => {
      const r = await deleteDraftTx(tx, key);
      if (r.ok) await record(tx, p, { action: AUDIT_ACTIONS.ruleDelete, detail: { key } }, 'zara_dev');
      return r;
    });
    writeDenied(result);
    await controlAudit(auditSql, p, AUDIT_ACTIONS.ruleDelete, { key });
    return { deleted: key };
  });

  app.post('/api/envs/:env/rules/:key/publish', async (req) => {
    const env = parseEnv((req.params as { env: string }).env) ?? fail400();
    if (env !== 'dev') throw badRequest('rule mutations are DEV-only');
    const { key } = req.params as { key: string };
    const p = req.principal;
    if (!canWriteDev(p.roles)) throw forbidden('dev write required');
    const result = await withTenantTx(needPool(rulesSql), p.tenantId, async (tx) => {
      const r = await publishDraftTx(tx, key);
      if (r.ok) await record(tx, p, { action: AUDIT_ACTIONS.rulePublish, detail: { key, sha256: r.sha256 } }, 'zara_dev');
      return r;
    });
    if (!result.ok) throw notFound('draft not found');
    await controlAudit(auditSql, p, AUDIT_ACTIONS.rulePublish, { key, sha256: result.sha256 });
    return { key, sha256: result.sha256 };
  });
}

/** Control-chain attestation — best-effort: the authoritative
 *  audit row is the env-schema row already committed in-tx. */
async function controlAudit(
  sql: Sql,
  p: { tenantId: string; sub: string; email?: string },
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await withTenantTx(sql, p.tenantId, (tx) => record(tx, p, { action, detail }));
  } catch {
    // never mask a successful mutation over a surface-attestation failure
  }
}

function fail400(): never {
  throw badRequest('unknown environment');
}
