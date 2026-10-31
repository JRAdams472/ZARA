//! Integration: promote → EngineControl publish push (ADR-0004).
//! The gRPC hop is strictly post-commit best-effort: a stub publisher
//! proves the call + response plumbing; a rejecting stub proves the
//! promotion still commits and reports published:false (the engine
//! poller converges). Gated on PROMOTE_/RULES_ DSNs.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { EnginePublisher, PublishResult } from '../../src/grpc/publish.js';
import { withTenantTx } from '../../src/db/pool.js';
import { ACME, makeKit, TEST_CONFIG, type Kit } from '../kit.js';

let kit: Kit | undefined;
let stubApp: FastifyInstance | undefined;
let downApp: FastifyInstance | undefined;
const calls: { tenantId: string; env: string; sha256: string }[] = [];
const KEY = 'it-pub';

const okStub: EnginePublisher = {
  publish(tenantId, env, sha256): Promise<PublishResult> {
    calls.push({ tenantId, env, sha256 });
    return Promise.resolve({ fingerprint: '9:2026-01-01', artifactCount: 2 });
  },
};
const downStub: EnginePublisher = {
  publish: () => Promise.reject(new Error('connect ECONNREFUSED')),
};

beforeAll(async () => {
  kit = await makeKit();
  if (!kit?.promoteSql || !kit.rulesSql) return;
  await withTenantTx(kit.sql, ACME, (tx) => tx`
    INSERT INTO zara_control.role_grants
      (tenant_id, subject_type, subject, role, granted_by)
    VALUES (${ACME}::uuid, 'sub', 'pub-eng', 'tenant_rule_engineer', 'testkit')
    ON CONFLICT DO NOTHING`);
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
  stubApp = await buildApp(TEST_CONFIG, {
    sql: kit.sql,
    validator: kit.validator,
    promoteSql: kit.promoteSql,
    enginePublisher: okStub,
  });
  downApp = await buildApp(TEST_CONFIG, {
    sql: kit.sql,
    validator: kit.validator,
    promoteSql: kit.promoteSql,
    enginePublisher: downStub,
  });
});

afterAll(async () => {
  await stubApp?.close();
  await downApp?.close();
  await kit?.app.close();
  await kit?.noCipherApp.close();
  await kit?.sql.end();
  await kit?.rulesSql?.end();
  await kit?.promoteSql?.end();
});

describe('promotion publish push', () => {
  it('stub called with (tenant, toEnv, sha256); response published:true', async () => {
    if (!stubApp) return;
    const e = await kit!.mint({ sub: 'pub-eng', envs: ['dev', 'qa'] });
    const res = await stubApp.inject({
      method: 'POST',
      url: `/api/envs/dev/rules/${KEY}/promote`,
      headers: { authorization: `Bearer ${e}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ toEnv: string; published: boolean; fingerprint?: string; sha256: string }>();
    expect(body.toEnv).toBe('qa');
    expect(body.published).toBe(true);
    expect(body.fingerprint).toBe('9:2026-01-01');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ tenantId: ACME, env: 'qa', sha256: body.sha256 });
  });

  it('publish failure → 200 + published:false + promote.publish audit row', async () => {
    if (!downApp) return;
    const e = await kit!.mint({ sub: 'pub-eng', envs: ['qa', 'uat'] });
    const res = await downApp.inject({
      method: 'POST',
      url: `/api/envs/qa/rules/${KEY}/promote`,
      headers: { authorization: `Bearer ${e}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ toEnv: string; published: boolean }>();
    expect(body.toEnv).toBe('uat');
    expect(body.published).toBe(false);
    // Failure is attested, not silent.
    const rows = await withTenantTx(kit!.sql, ACME, (tx) => tx<
      { action: string; detail: { ok?: boolean } }[]
    >`SELECT action, detail FROM zara_control.audit_events
        WHERE action = 'promote.publish' ORDER BY id DESC LIMIT 1`);
    expect(rows[0]?.detail.ok).toBe(false);
  });
});
