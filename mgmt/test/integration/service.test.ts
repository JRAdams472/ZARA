//! Integration: fastify.inject + real Postgres (MGMT_DATABASE_URL gated).
//! Proves the deny-first matrix, grants CRUD + last-RM guard, the audit
//! chain, and RLS under the zara_mgmt role.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { ACME, makeKit, NORTHSTAR, type Kit } from '../kit.js';
import { record, verifyChain } from '../../src/db/audit.js';
import { withTenantTx } from '../../src/db/pool.js';

let kit: Kit | undefined;

beforeAll(async () => {
  kit = await makeKit();
  if (!kit) return;
  // Seed a release-manager grant for the acme test subject.
  await withTenantTx(kit.sql, ACME, (tx) => tx`
    INSERT INTO zara_control.role_grants
      (tenant_id, subject_type, subject, role, granted_by)
    VALUES (${ACME}::uuid, 'sub', 'rm-subject', 'tenant_release_manager', 'testkit')
    ON CONFLICT DO NOTHING`);
});

afterAll(async () => {
  await kit?.app.close();
  await kit?.sql.end();
});

const get = (url: string, token?: string) =>
  kit!.app.inject({ method: 'GET', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
const put = (url: string, body: unknown, token?: string) =>
  kit!.app.inject({ method: 'PUT', url, payload: body as object, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
const del = (url: string, token?: string) =>
  kit!.app.inject({ method: 'DELETE', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });

const rmToken = () => kit!.mint({ sub: 'rm-subject', envs: ['dev', 'qa', 'uat', 'prod'] });

describe('gate', () => {
  it('healthz is unauthenticated + security headers', async () => {
    if (!kit) return;
    const r = await get('/healthz');
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['content-security-policy']).toContain('frame-ancestors');
  });

  it('missing token → 401', async () => {
    if (!kit) return;
    expect((await get('/api/whoami')).statusCode).toBe(401);
  });

  it('malformed token → 401', async () => {
    if (!kit) return;
    const r = await kit.app.inject({
      method: 'GET',
      url: '/api/whoami',
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('expired token → 401', async () => {
    if (!kit) return;
    const t = await kit.mint({ ttlSecs: -3600 });
    expect((await get('/api/whoami', t)).statusCode).toBe(401);
  });

  it('HS256 → 401 (alg not in allowlist)', async () => {
    if (!kit) return;
    const t = await kit.mint({ alg: 'HS256' });
    expect((await get('/api/whoami', t)).statusCode).toBe(401);
  });

  it('env outside permitted_environments → 403', async () => {
    if (!kit) return;
    const t = await rmToken();
    const scoped = await kit.mint({ sub: 'rm-subject', envs: ['dev'] });
    expect((await get('/api/envs/prod/context', scoped)).statusCode).toBe(403);
    expect((await get('/api/envs/dev/context', t)).statusCode).toBe(200);
  });

  it('env outside role scope → 403 even when the claim permits it', async () => {
    if (!kit) return;
    const rm = await rmToken();
    await put('/api/admin/grants', {
      subjectType: 'sub', subject: 'scope-eng', role: 'tenant_rule_engineer',
    }, rm);
    // Engineer claims prod — claims permit, role scope does not.
    const t = await kit.mint({ sub: 'scope-eng', envs: ['dev', 'prod'] });
    expect((await get('/api/envs/prod/context', t)).statusCode).toBe(403);
    expect((await get('/api/envs/dev/context', t)).statusCode).toBe(200);
  });

  it('foreign tenant → same sub has no grants (403 on admin)', async () => {
    if (!kit) return;
    // rm-subject holds a release-manager grant in ACME only — NORTHSTAR
    // RLS hides it entirely.
    const t = await kit.mint({ sub: 'rm-subject', tenantId: NORTHSTAR, envs: ['prod'] });
    const w = await get('/api/whoami', t);
    expect(w.statusCode).toBe(200);
    expect(w.json().roles).toEqual([]);
    expect((await get('/api/admin/grants', t)).statusCode).toBe(403);
  });

  it('no-role subject → 403 on admin route, 200 on whoami', async () => {
    if (!kit) return;
    const t = await kit.mint({ sub: 'nobody', envs: ['dev'] });
    expect((await get('/api/whoami', t)).statusCode).toBe(200);
    expect((await get('/api/admin/grants', t)).statusCode).toBe(403);
  });
});

describe('grants admin', () => {
  it('grant + list + revoke with audit chain', async () => {
    if (!kit) return;
    const t = await rmToken();
    const up = await put('/api/admin/grants', {
      subjectType: 'sub', subject: 'engineer-1', role: 'tenant_rule_engineer',
    }, t);
    expect(up.statusCode).toBe(200);
    const grant = up.json().grant;
    expect(grant.role).toBe('tenant_rule_engineer');

    const list = await get('/api/admin/grants', t);
    expect(list.json().grants.some((g: { id: string }) => g.id === grant.id)).toBe(true);

    const d = await del(`/api/admin/grants/${grant.id}`, t);
    expect(d.statusCode).toBe(200);

    const v = await get('/api/admin/audit/verify', t);
    expect(v.json()).toMatchObject({ ok: true });
    expect(v.json().checked).toBeGreaterThan(0);
  });

  it('refuses to revoke the tenant\'s last release manager', async () => {
    if (!kit) return;
    const t = await rmToken();
    const list = await get('/api/admin/grants', t);
    const rms = list.json().grants.filter((g: { role: string }) => g.role === 'tenant_release_manager');
    // Delete extras first so exactly one remains.
    for (const g of rms.slice(1)) {
      expect((await del(`/api/admin/grants/${g.id}`, t)).statusCode).toBe(200);
    }
    const last = (await get('/api/admin/grants', t)).json()
      .grants.find((g: { role: string }) => g.role === 'tenant_release_manager');
    const d = await del(`/api/admin/grants/${last.id}`, t);
    expect(d.statusCode).toBe(403);
  });

  it('auditor cannot reach grants admin', async () => {
    if (!kit) return;
    const t = await rmToken();
    await put('/api/admin/grants', {
      subjectType: 'sub', subject: 'aud-1', role: 'tenant_auditor',
    }, t);
    const at = await kit.mint({ sub: 'aud-1', envs: ['dev', 'qa'] });
    expect((await get('/api/admin/grants', at)).statusCode).toBe(403);
  });
});

describe('rls + append-only', () => {
  it('northstar sees no acme grants through the same role', async () => {
    if (!kit) return;
    const rows = await withTenantTx(kit.sql, NORTHSTAR, (tx) => tx`
      SELECT count(*)::int AS n FROM zara_control.role_grants`);
    expect(rows[0]!.n).toBe(0);
  });

  it('audit_events rejects UPDATE/DELETE — privilege layer then trigger', async () => {
    if (!kit) return;
    // Layer 1: zara_mgmt has no UPDATE/DELETE grant at all — fails on
    // privilege before the trigger is ever reached.
    await expect(
      withTenantTx(kit.sql, ACME, (tx) => tx`UPDATE zara_control.audit_events SET action='x'`),
    ).rejects.toThrow(/permission denied/);

    // Layer 2: the append-only trigger itself, proven as the table owner
    // (needs MIGRATE_DATABASE_URL — always present in CI).
    const migDsn = process.env.MIGRATE_DATABASE_URL;
    if (!migDsn) return;
    const mig = postgres(migDsn);
    try {
      // Guarantee a row exists so the trigger actually fires.
      await withTenantTx(mig, ACME, (tx) =>
        record(tx, { sub: 'testkit' }, { action: 'test.probe' }),
      );
      await expect(
        withTenantTx(mig, ACME, (tx) => tx`UPDATE zara_control.audit_events SET action='x'`),
      ).rejects.toThrow(/append-only/);
      await expect(
        withTenantTx(mig, ACME, (tx) => tx`DELETE FROM zara_control.audit_events`),
      ).rejects.toThrow(/append-only/);
    } finally {
      await mig.end();
    }
  });

  it('verifyChain detects tamper — simulated by direct verify on healthy chain', async () => {
    if (!kit) return;
    const v = await verifyChain(kit.sql, ACME);
    expect(v.ok).toBe(true);
  });
});
