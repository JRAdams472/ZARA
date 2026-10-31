import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
}));

import { beginLogin, finishLogin } from '@/lib/auth';
import { PKCE_COOKIE, SESSION_COOKIE, STATE_COOKIE } from '@/lib/session';

beforeEach(() => {
  jar.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('beginLogin', () => {
  it('builds the authorize URL with PKCE + state and stashes cookies', async () => {
    const url = new URL(await beginLogin('/dev/rules'));
    expect(url.origin + url.pathname).toBe('http://dex.test/auth');
    expect(url.searchParams.get('client_id')).toBe('zara-web');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3400/auth/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('scope')).toContain('openid');

    const state = url.searchParams.get('state')!;
    expect(jar.get(STATE_COOKIE)).toBe(`${state}|/dev/rules`);
    expect(jar.get(PKCE_COOKIE)).toBeTruthy();
  });
});

describe('finishLogin', () => {
  async function idToken(claims: Record<string, unknown>) {
    const { privateKey } = await generateKeyPair('RS256');
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);
  }

  function seedPkceCookies(state: string, next = '/') {
    jar.set(PKCE_COOKIE, 'verifier-abc');
    jar.set(STATE_COOKIE, `${state}|${next}`);
  }

  function stubTokenExchange(tokens: Record<string, unknown>) {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify(tokens), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('rejects a mismatched state without calling the token endpoint', async () => {
    const spy = stubTokenExchange({});
    seedPkceCookies('good-state');
    await expect(finishLogin('code', 'evil-state')).rejects.toThrow('bad oauth state');
    expect(spy).not.toHaveBeenCalled();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it('exchanges the code, seals a session, returns the next path', async () => {
    const token = await idToken({ sub: 'engineer-user', email: 'engineer@zara.dev' });
    stubTokenExchange({
      access_token: 'dex-at',
      refresh_token: 'dex-rt',
      expires_in: 3600,
      id_token: token,
    });
    seedPkceCookies('s1', '/qa/rules');

    const next = await finishLogin('auth-code', 's1');
    expect(next).toBe('/qa/rules');
    expect(jar.get(SESSION_COOKIE)?.split('.')).toHaveLength(5);
    expect(jar.has(PKCE_COOKIE)).toBe(false);
    expect(jar.has(STATE_COOKIE)).toBe(false);

    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(call[0]).toBe('http://dex.test/token');
    const body = call[1]!.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('code_verifier')).toBe('verifier-abc');
    expect(body.get('client_secret')).toBeNull(); // public client — PKCE only
  });

  it('surfaces token-endpoint errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      ),
    );
    seedPkceCookies('s1');
    await expect(finishLogin('bad-code', 's1')).rejects.toThrow('invalid_grant');
  });

  it('dev exchange mode resolves claims for a mapped user', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const { exportPKCS8 } = await import('jose');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const keyFile = join(mkdtempSync(join(tmpdir(), 'zk-')), 'dev.pem');
    writeFileSync(keyFile, await exportPKCS8(privateKey));
    void publicKey;

    vi.stubEnv('ZARA_DEV_KEY_FILE', keyFile);
    vi.stubEnv('DEV_TENANT_ID', 'aa5ce000-0000-4000-8000-0000000000ac');
    vi.stubEnv('DEV_ENVS', 'dev,qa');
    vi.resetModules();
    const { finishLogin: fl } = await import('@/lib/auth');
    const { readSession } = await import('@/lib/session');

    const token = await new SignJWT({ email: 'engineer@zara.dev' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('engineer-user')
      .sign(privateKey);
    stubTokenExchange({ access_token: 'a', expires_in: 3600, id_token: token });
    seedPkceCookies('s2');

    await fl('code', 's2');
    const s = await readSession();
    expect(s?.dev).toEqual({
      tenantId: 'aa5ce000-0000-4000-8000-0000000000ac',
      envs: ['dev', 'qa'],
    });
    expect(s?.sub).toBe('engineer-user');
  });

  it('dev exchange mode fails closed for an unmappable user', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const { exportPKCS8 } = await import('jose');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const keyFile = join(mkdtempSync(join(tmpdir(), 'zk-')), 'dev.pem');
    writeFileSync(keyFile, await exportPKCS8(privateKey));

    vi.stubEnv('ZARA_DEV_KEY_FILE', keyFile);
    vi.stubEnv('DEV_TENANT_ID', '');
    vi.stubEnv('DEV_ENVS', '');
    vi.resetModules();
    const { finishLogin: fl } = await import('@/lib/auth');

    const token = await new SignJWT({ email: 'nobody@zara.dev' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('nobody')
      .sign(privateKey);
    stubTokenExchange({ access_token: 'a', expires_in: 3600, id_token: token });
    seedPkceCookies('s3');
    await expect(fl('code', 's3')).rejects.toThrow('no dev claims');
  });
});
