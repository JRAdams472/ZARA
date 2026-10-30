//! Integration: rule lifecycle — draft CRUD in dev, publish→immutable,
//! PII rejection, role gates, tenant isolation. Gated on the
//! RULES_/PROMOTE_ DSNs (CI provides them).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACME, makeKit, type Kit } from '../kit.js';
import { withTenantTx } from '../../src/db/pool.js';

let kit: Kit | undefined;
const KEY = 'it-origination';
const JDM = {
  nodes: [
    { id: 'in', type: 'inputNode', name: 'Loan scenario' },
    { id: 'tbl', type: 'decisionTableNode', name: 'Base fee', content: {} },
  ],
  edges: [{ id: 'e1', sourceId: 'in', targetId: 'tbl' }],
};

beforeAll(async () => {
  kit = await makeKit();
  if (!kit) return;
  for (const [subject, role] of [
    ['rm-subject', 'tenant_release_manager'],
    ['eng-subject', 'tenant_rule_engineer'],
    ['aud-subject', 'tenant_auditor'],
  ] as const) {
    await withTenantTx(kit.sql, ACME, (tx) => tx`
      INSERT INTO zara_control.role_grants
        (tenant_id, subject_type, subject, role, granted_by)
      VALUES (${ACME}::uuid, 'sub', ${subject}, ${role}, 'testkit')
      ON CONFLICT DO NOTHING`);
  }
  // Clean any leftover fixture.
  if (kit.rulesSql) {
    await withTenantTx(kit.rulesSql, ACME, (tx) => tx`
      DELETE FROM zara_dev.rule_artifacts WHERE key = ${KEY} AND status = 'draft'`).catch(() => undefined);
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

const rm = () => kit!.mint({ sub: 'rm-subject', envs: ['dev', 'qa', 'uat', 'prod'] });
const eng = () => kit!.mint({ sub: 'eng-subject', envs: ['dev', 'qa', 'uat'] });
const aud = () => kit!.mint({ sub: 'aud-subject', envs: ['qa', 'uat'] });

const live = () => kit?.rulesSql != null && kit.promoteSql != null;

describe('rule lifecycle (DSN-gated)', () => {
  it('create → list → update → publish → sha256', async () => {
    if (!live()) return;
    const t = await eng();
    const create = await call('POST', '/api/envs/dev/rules', t, { key: KEY, kind: 'base_fee', spec: JDM });
    expect(create.statusCode).toBe(201);
    const list = await call('GET', '/api/envs/dev/rules', t);
    expect(list.statusCode).toBe(200);
    const names = list.json<{ rules: { key: string }[] }>().rules.map((r) => r.key);
    expect(names).toContain(KEY);
    const put = await call('PUT', `/api/envs/dev/rules/${KEY}`, t, { spec: JDM });
    expect(put.statusCode).toBe(200);
    const pub = await call('POST', `/api/envs/dev/rules/${KEY}/publish`, t);
    expect(pub.statusCode).toBe(200);
    const sha = pub.json<{ sha256: string }>().sha256;
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    // sha256 equals Postgres's encode(sha256(jdm::text)) — same as seeds.
    const rows = await withTenantTx(kit!.promoteSql!, ACME, (tx) => tx<{ sha256: string }[]>`
      SELECT sha256 FROM zara_dev.rule_artifacts WHERE key = ${KEY} AND status = 'published'`);
    expect(rows[0]?.sha256).toBe(sha);
  });

  it('draft stays editable post-publish; published-only keys reject mutation', async () => {
    if (!live()) return;
    const t = await eng();
    // KEY has draft + published rows — updates target the draft.
    expect((await call('PUT', `/api/envs/dev/rules/${KEY}`, t, { spec: JDM })).statusCode).toBe(200);
    // Removing the draft leaves only the immutable published row.
    expect((await call('DELETE', `/api/envs/dev/rules/${KEY}`, t)).statusCode).toBe(200);
    expect((await call('PUT', `/api/envs/dev/rules/${KEY}`, t, { spec: JDM })).statusCode).toBe(403);
    expect((await call('DELETE', `/api/envs/dev/rules/${KEY}`, t)).statusCode).toBe(403);
    const draft = 'it-draft-only';
    await call('POST', '/api/envs/dev/rules', t, { key: draft, kind: 'adjustment_set', spec: JDM });
    expect((await call('DELETE', `/api/envs/dev/rules/${draft}`, t)).statusCode).toBe(200);
  });

  it('PII + bad shapes are 400; auditor is 403; mutations are dev-only', async () => {
    if (!live()) return;
    const t = await eng();
    expect((await call('POST', '/api/envs/dev/rules', t, { key: 'pii-x', kind: 'base_fee', spec: { nodes: [{ id: 'a' }], edges: [], ssn: 'x' } })).statusCode).toBe(400);
    expect((await call('POST', '/api/envs/dev/rules', t, { key: 'bad', kind: 'base_fee', spec: { nope: 1 } })).statusCode).toBe(400);
    expect((await call('POST', '/api/envs/dev/rules', t, { key: 'Bad Key!', kind: 'base_fee', spec: JDM })).statusCode).toBe(400);
    expect((await call('POST', '/api/envs/qa/rules', t, { key: 'x', kind: 'base_fee', spec: JDM })).statusCode).toBe(400);
    expect((await call('GET', '/api/envs/dev/rules', await aud())).statusCode).toBe(403);
    expect((await call('POST', '/api/envs/dev/rules', await aud(), { key: 'x', kind: 'base_fee', spec: JDM })).statusCode).toBe(403);
    // RM can also write dev.
    expect((await call('GET', '/api/envs/dev/rules', await rm())).statusCode).toBe(200);
  });

  it('tenant isolation — northstar principal sees no acme rules', async () => {
    if (!live()) return;
    // rm-subject holds only acme grants → zero roles for northstar.
    const t = await kit!.mint({ sub: 'rm-subject', tenantId: 'bb0215a0-0000-4000-8000-0000000000b2', envs: ['dev'] });
    expect((await call('GET', '/api/envs/dev/rules', t)).statusCode).toBe(403);
    // And via promoteSql+RLS the acme row is invisible to northstar.
    const rows = await withTenantTx(kit!.promoteSql!, 'bb0215a0-0000-4000-8000-0000000000b2', (tx) => tx`
      SELECT key FROM zara_dev.rule_artifacts WHERE key = ${KEY}`);
    expect(rows).toHaveLength(0);
  });
});
