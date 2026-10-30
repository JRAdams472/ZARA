//! Integration: promotion — unskippable chain, RBAC matrix, verbatim
//! published copy + history attestation, append-only. Gated on
//! RULES_/PROMOTE_ DSNs.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACME, makeKit, type Kit } from '../kit.js';
import { withTenantTx } from '../../src/db/pool.js';

let kit: Kit | undefined;
const KEY = 'it-promo';

beforeAll(async () => {
  kit = await makeKit();
  if (!kit?.promoteSql) return;
  for (const [subject, role] of [
    ['rm-subject', 'tenant_release_manager'],
    ['eng-subject', 'tenant_rule_engineer'],
  ] as const) {
    await withTenantTx(kit.sql, ACME, (tx) => tx`
      INSERT INTO zara_control.role_grants
        (tenant_id, subject_type, subject, role, granted_by)
      VALUES (${ACME}::uuid, 'sub', ${subject}, ${role}, 'testkit')
      ON CONFLICT DO NOTHING`);
  }
  // Seed a published artifact in dev directly (fixture isolation).
  if (kit.rulesSql) {
    await withTenantTx(kit.rulesSql, ACME, async (tx) => {
      await tx`DELETE FROM zara_dev.rule_artifacts WHERE key = ${KEY} AND status = 'draft'`;
      await tx`
        INSERT INTO zara_dev.rule_artifacts
          (tenant_id, key, kind, status, spec, jdm, sha256, created_by, published_at)
        VALUES (
          current_setting('zara.tenant_id')::uuid, ${KEY}, 'base_fee', 'published',
          '{"nodes":[],"edges":[]}'::jsonb, '{"nodes":[],"edges":[]}'::jsonb,
          encode(sha256('{"edges":[],"nodes":[]}'::bytea), 'hex'), 'testkit', now())
        ON CONFLICT DO NOTHING`;
    });
  }
});

afterAll(async () => {
  await kit?.app.close();
  await kit?.noCipherApp.close();
  await kit?.sql.end();
  await kit?.rulesSql?.end();
  await kit?.promoteSql?.end();
});

const call = (method: string, url: string, token?: string, body?: unknown) =>
  kit!.app.inject({
    method: method as 'GET',
    url,
    ...(body !== undefined ? { payload: body as object } : {}),
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });

const eng = () => kit!.mint({ sub: 'eng-subject', envs: ['dev', 'qa', 'uat', 'prod'] });
const rm = () => kit!.mint({ sub: 'rm-subject', envs: ['dev', 'qa', 'uat', 'prod'] });

describe('promotion chain', () => {
  it('dev→qa→uat by engineer; uat→prod denied; RM signs off', async () => {
    if (!kit?.promoteSql) return;
    const e = await eng();
    const r = await rm();
    const qa = await call('POST', `/api/envs/dev/rules/${KEY}/promote`, e);
    expect(qa.statusCode).toBe(200);
    const qaBody = qa.json<{ toEnv: string; sha256: string; artifactId: string }>();
    expect(qaBody.toEnv).toBe('qa');
    expect(qaBody.sha256).toMatch(/^[0-9a-f]{64}$/);
    const uat = await call('POST', `/api/envs/qa/rules/${KEY}/promote`, e);
    expect(uat.statusCode).toBe(200);
    expect(uat.json<{ toEnv: string }>().toEnv).toBe('uat');
    // Engineer cannot sign off prod.
    expect((await call('POST', `/api/envs/uat/rules/${KEY}/promote`, e)).statusCode).toBe(403);
    // RM can.
    const prod = await call('POST', `/api/envs/uat/rules/${KEY}/promote`, r);
    expect(prod.statusCode).toBe(200);
    expect(prod.json<{ toEnv: string }>().toEnv).toBe('prod');
    // prod has no successor — DEV→PROD is inexpressible by construction.
    expect((await call('POST', `/api/envs/prod/rules/${KEY}/promote`, r)).statusCode).toBe(400);
  });

  it('history + verbatim copy attested in the target env', async () => {
    if (!kit?.promoteSql) return;
    const t = await rm();
    const hist = await call('GET', '/api/envs/prod/promotions', t);
    expect(hist.statusCode).toBe(200);
    const rows = hist.json<{ promotions: { artifactKey: string; fromEnv: string; toEnv: string; graphSha256: string; promotedBy: string }[] }>().promotions;
    const row = rows.find((p) => p.artifactKey === KEY && p.toEnv === 'prod');
    expect(row).toBeDefined();
    expect(row!.fromEnv).toBe('uat');
    expect(row!.promotedBy).toBe('rm-subject');
    expect(row!.graphSha256).toMatch(/^[0-9a-f]{64}$/);
    // Prod artifact carries the SAME sha256 as the dev published row.
    const dev = await withTenantTx(kit.promoteSql, ACME, (tx) => tx<{ sha256: string }[]>`
      SELECT sha256 FROM zara_dev.rule_artifacts WHERE key = ${KEY} AND status = 'published'
      ORDER BY published_at DESC LIMIT 1`);
    const prod = await withTenantTx(kit.promoteSql, ACME, (tx) => tx<{ sha256: string }[]>`
      SELECT sha256 FROM zara_prod.rule_artifacts WHERE key = ${KEY} AND status = 'published'
      ORDER BY published_at DESC LIMIT 1`);
    expect(prod[0]?.sha256).toBe(dev[0]?.sha256);
    expect(row!.graphSha256).toBe(dev[0]?.sha256);
  });

  it('promote nonexistent published → 404; auditor → 403', async () => {
    if (!kit?.promoteSql) return;
    const e = await eng();
    expect((await call('POST', '/api/envs/dev/rules/does-not-exist/promote', e)).statusCode).toBe(404);
    const aud = await kit.mint({ sub: 'aud-subject', envs: ['dev', 'qa'] });
    await withTenantTx(kit.sql, ACME, (tx) => tx`
      INSERT INTO zara_control.role_grants
        (tenant_id, subject_type, subject, role, granted_by)
      VALUES (${ACME}::uuid, 'sub', 'aud-subject', 'tenant_auditor', 'testkit')
      ON CONFLICT DO NOTHING`);
    expect((await call('POST', `/api/envs/dev/rules/${KEY}/promote`, aud)).statusCode).toBe(403);
  });
});
