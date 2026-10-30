//! Integration: secrets surface — ciphertext-only persistence, KMS-503
//! behavior, RBAC-scoped metadata, tenant isolation, audit rows.
//! Cipher-backed cases gate on kit.cipher (KMS_URL + KMS_TOKEN_FILE —
//! CI provides dev-mode OpenBao); the 503/403 paths run anywhere
//! Postgres does, via noCipherApp sharing the kit validator.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ACME, makeKit, NORTHSTAR, type Kit } from '../kit.js';
import { verifyChain } from '../../src/db/audit.js';
import { withTenantTx } from '../../src/db/pool.js';
import { isEnvelope } from '../../src/kms/cipher.js';

let kit: Kit | undefined;

beforeAll(async () => {
  kit = await makeKit();
  if (!kit) return;
  for (const [tenant, subject, role] of [
    [ACME, 'rm-subject', 'tenant_release_manager'],
    [ACME, 'eng-subject', 'tenant_rule_engineer'],
    [ACME, 'aud-subject', 'tenant_auditor'],
  ] as const) {
    await withTenantTx(kit.sql, tenant, (tx) => tx`
      INSERT INTO zara_control.role_grants
        (tenant_id, subject_type, subject, role, granted_by)
      VALUES (${tenant}::uuid, 'sub', ${subject}, ${role}, 'testkit')
      ON CONFLICT DO NOTHING`);
  }
});

afterAll(async () => {
  await kit?.app.close();
  await kit?.noCipherApp.close();
  await kit?.sql.end();
});

const call = (app: FastifyInstance, method: string, url: string, token?: string, body?: unknown) =>
  app.inject({
    method: method as 'GET',
    url,
    ...(body !== undefined ? { payload: body as object } : {}),
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });

const rmToken = () => kit!.mint({ sub: 'rm-subject', envs: ['dev', 'qa', 'uat', 'prod'] });
const engToken = () => kit!.mint({ sub: 'eng-subject', envs: ['dev', 'qa', 'uat'] });
const audToken = () => kit!.mint({ sub: 'aud-subject', envs: ['qa', 'uat'] });
const northstarRm = () =>
  kit!.mint({ sub: 'rm-subject', tenantId: NORTHSTAR, envs: ['dev', 'qa', 'uat', 'prod'] });

const SECRET = 'it-secret-key';
const PLAINTEXT = 's3cr3t-value-åéî-🚀';

describe('unset KMS → 503 on every secrets route', () => {
  it('PUT/GET/rewrap all 503; rest of service unaffected', async () => {
    if (!kit) return;
    const t = await rmToken();
    expect((await call(kit.noCipherApp, 'PUT', `/api/admin/secrets/${SECRET}`, t, { value: 'x' })).statusCode).toBe(503);
    expect((await call(kit.noCipherApp, 'GET', '/api/admin/secrets', t)).statusCode).toBe(503);
    expect((await call(kit.noCipherApp, 'POST', `/api/admin/secrets/${SECRET}/rewrap`, t)).statusCode).toBe(503);
    // …while the rest of the service works:
    expect((await call(kit.noCipherApp, 'GET', '/api/whoami', t)).statusCode).toBe(200);
    expect((await call(kit.noCipherApp, 'GET', '/healthz')).statusCode).toBe(200);
  });

  it('auditor still gets 403 (deny-first precedes the KMS check)', async () => {
    if (!kit) return;
    const t = await audToken();
    expect((await call(kit.noCipherApp, 'GET', '/api/admin/secrets', t)).statusCode).toBe(403);
  });
});

describe('cipher-backed surface (KMS-gated)', () => {
  it('PUT encrypts and persists an envelope — never plaintext', async () => {
    if (!kit?.cipher) return;
    const t = await rmToken();
    const r = await call(kit.app, 'PUT', `/api/admin/secrets/${SECRET}`, t, { value: PLAINTEXT });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ name: SECRET });
    // DB holds a vault:vN: envelope, and the plaintext appears nowhere.
    const rows = await withTenantTx(kit.sql, ACME, (tx) => tx<{ ciphertext: string; key_name: string }[]>`
      SELECT ciphertext, key_name FROM zara_control.tenant_secrets WHERE name = ${SECRET}`);
    expect(rows).toHaveLength(1);
    expect(isEnvelope(rows[0]!.ciphertext)).toBe(true);
    expect(rows[0]!.ciphertext).not.toContain(PLAINTEXT);
    expect(rows[0]!.key_name).toBe('zara-mgmt-secrets');
  });

  it('decrypt round-trips through the cipher seam', async () => {
    if (!kit?.cipher) return;
    const rows = await withTenantTx(kit.sql, ACME, (tx) => tx<{ ciphertext: string }[]>`
      SELECT ciphertext FROM zara_control.tenant_secrets WHERE name = ${SECRET}`);
    expect(await kit.cipher.decrypt(rows[0]!.ciphertext)).toBe(PLAINTEXT);
  });

  it('GET returns metadata only — three role views', async () => {
    if (!kit?.cipher) return;
    const rm = await call(kit.app, 'GET', '/api/admin/secrets', await rmToken());
    expect(rm.statusCode).toBe(200);
    const body = JSON.parse(rm.body) as { secrets: Record<string, unknown>[] };
    const meta = body.secrets.find((s) => s.name === SECRET);
    expect(meta).toBeDefined();
    expect(meta!.keyName).toBe('zara-mgmt-secrets');
    expect(meta!.keyVersion).toBe('1');
    expect(meta!.updatedBy).toBe('rm-subject');
    // No plaintext or ciphertext anywhere in the response.
    expect(rm.body).not.toContain('vault:');
    expect(rm.body).not.toContain(PLAINTEXT);
    expect(meta).not.toHaveProperty('ciphertext');
    expect(meta).not.toHaveProperty('value');

    const eng = await call(kit.app, 'GET', '/api/admin/secrets', await engToken());
    expect(eng.statusCode).toBe(200);
    const engMeta = (JSON.parse(eng.body) as typeof body).secrets.find((s) => s.name === SECRET);
    expect(engMeta).toBeDefined();
    expect(engMeta!.keyVersion).toBe('1');
    expect(engMeta).not.toHaveProperty('updatedBy');

    expect((await call(kit.app, 'GET', '/api/admin/secrets', await audToken())).statusCode).toBe(403);
  });

  it('tenant isolation — acme RM minted for northstar is denied', async () => {
    if (!kit?.cipher) return;
    // rm-subject holds acme RM but zero northstar grants: RLS hides the
    // grant rows, no role resolves, secrets metadata stays unreachable.
    const r = await call(kit.app, 'GET', '/api/admin/secrets', await northstarRm());
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain(SECRET);
  });

  it('non-RM cannot write; bad names/bodies are rejected', async () => {
    if (!kit?.cipher) return;
    expect((await call(kit.app, 'PUT', `/api/admin/secrets/${SECRET}`, await engToken(), { value: 'x' })).statusCode).toBe(403);
    expect((await call(kit.app, 'PUT', '/api/admin/secrets/Bad_Name!', await rmToken(), { value: 'x' })).statusCode).toBe(400);
    expect((await call(kit.app, 'PUT', `/api/admin/secrets/${SECRET}`, await rmToken(), { nope: 1 })).statusCode).toBe(400);
  });

  it('rewrap re-seals under the latest key version + audit rows land', async () => {
    if (!kit?.cipher) return;
    const t = await rmToken();
    const r = await call(kit.app, 'POST', `/api/admin/secrets/${SECRET}/rewrap`, t);
    expect(r.statusCode).toBe(200);
    // Still a valid envelope that round-trips to the same plaintext.
    const rows = await withTenantTx(kit.sql, ACME, (tx) => tx<{ ciphertext: string }[]>`
      SELECT ciphertext FROM zara_control.tenant_secrets WHERE name = ${SECRET}`);
    expect(isEnvelope(rows[0]!.ciphertext)).toBe(true);
    expect(await kit.cipher.decrypt(rows[0]!.ciphertext)).toBe(PLAINTEXT);
    // Attributed audit rows; chain still verifies end-to-end.
    const evts = await withTenantTx(kit.sql, ACME, (tx) => tx<{ action: string; actor_sub: string }[]>`
      SELECT action, actor_sub FROM zara_control.audit_events
       WHERE action IN ('secret.put', 'secret.rewrap') ORDER BY id`);
    const actions = evts.map((e) => e.action);
    expect(actions).toContain('secret.put');
    expect(actions).toContain('secret.rewrap');
    expect(evts.every((e) => e.actor_sub === 'rm-subject')).toBe(true);
    const chain = await verifyChain(kit.sql, ACME);
    expect(chain.ok).toBe(true);
  });

  it('rewrap on a missing secret → 404', async () => {
    if (!kit?.cipher) return;
    expect((await call(kit.app, 'POST', '/api/admin/secrets/nope/rewrap', await rmToken())).statusCode).toBe(404);
  });
});
