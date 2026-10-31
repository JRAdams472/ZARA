import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionData } from '@/lib/session';

// bearer.ts resolves mode at import time (ZARA_DEV_KEY_FILE presence), so
// each test re-imports a fresh module under its own env.
const tmp = mkdtempSync(join(tmpdir(), 'zara-web-key-'));
const keyPath = join(tmp, 'dev.pem');
let publicJwk: Record<string, unknown>;

async function freshBearer() {
  vi.resetModules();
  return await import('@/lib/bearer');
}

const session: SessionData = {
  at: 'idp-access-token',
  exp: Date.now() + 3_600_000,
  sub: 'engineer-user',
  email: 'engineer@zara.dev',
};

describe('bearerFor', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passthrough mode returns the IdP access token', async () => {
    vi.stubEnv('ZARA_DEV_KEY_FILE', '');
    const { bearerFor, DEV_EXCHANGE_ENABLED } = await freshBearer();
    expect(DEV_EXCHANGE_ENABLED).toBe(false);
    expect(await bearerFor(session)).toBe('idp-access-token');
  });

  it('passthrough mode fails closed without an access token', async () => {
    vi.stubEnv('ZARA_DEV_KEY_FILE', '');
    const { bearerFor } = await freshBearer();
    await expect(bearerFor({ ...session, at: undefined })).rejects.toThrow('no access token');
  });

  it('dev exchange mints a verifiable zara-devtoken bearer', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    writeFileSync(keyPath, await exportPKCS8(privateKey));
    publicJwk = (await exportJWK(publicKey)) as Record<string, unknown>;
    vi.stubEnv('ZARA_DEV_KEY_FILE', keyPath);
    vi.stubEnv('ZARA_TOKEN_AUDIENCE', 'zara-mgmt');

    const { bearerFor, DEV_EXCHANGE_ENABLED } = await freshBearer();
    expect(DEV_EXCHANGE_ENABLED).toBe(true);

    const devSession: SessionData = {
      ...session,
      dev: { tenantId: 'aa5ce000-0000-4000-8000-0000000000ac', envs: ['dev', 'qa'] },
    };
    const jwt = await bearerFor(devSession);
    const { payload } = await jwtVerify(jwt, publicJwk as never);
    expect(payload.iss).toBe('zara-devtoken');
    expect(payload.aud).toBe('zara-mgmt');
    expect(payload.sub).toBe('engineer-user');
    expect(payload.tenant_id).toBe('aa5ce000-0000-4000-8000-0000000000ac');
    expect(payload.permitted_environments).toEqual(['dev', 'qa']);
    expect(payload.email).toBe('engineer@zara.dev');
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(120);
  });

  it('dev exchange fails closed when session lacks resolved claims', async () => {
    writeFileSync(keyPath, 'placeholder');
    vi.stubEnv('ZARA_DEV_KEY_FILE', keyPath);
    const { bearerFor } = await freshBearer();
    await expect(bearerFor(session)).rejects.toThrow('no resolved claims');
  });
});

process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
