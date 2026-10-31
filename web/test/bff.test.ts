import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { exportPKCS8, generateKeyPair } from 'jose';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
}));

import { GET, POST } from '@/app/bff/[...path]/route';
import { SESSION_COOKIE, setSession } from '@/lib/session';

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
const req = (url: string, init?: RequestInit) =>
  new NextRequest(new Request(url, init));

beforeEach(() => {
  jar.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubUpstream(status = 200, body: unknown = { ok: true }) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('bff proxy', () => {
  it('401s without a session and never touches upstream', async () => {
    const spy = stubUpstream();
    const res = await GET(req('http://localhost:3400/bff/api/whoami'), ctx(['api', 'whoami']));
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('forwards path + query upstream with the session bearer (passthrough)', async () => {
    vi.stubEnv('ZARA_DEV_KEY_FILE', '');
    await setSession({
      at: 'idp-token',
      exp: Date.now() + 3_600_000,
      sub: 'engineer-user',
    });
    jar.get(SESSION_COOKIE);
    const spy = stubUpstream(200, { rules: [] });
    const res = await GET(
      req('http://localhost:3400/bff/api/envs/dev/rules?limit=5'),
      ctx(['api', 'envs', 'dev', 'rules']),
    );
    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('http://mgmt.test/api/envs/dev/rules?limit=5');
    expect((init.headers as Headers).get('authorization')).toBe('Bearer idp-token');
    expect(await res.json()).toEqual({ rules: [] });
  });

  it('dev exchange mode forwards a minted zara bearer, not the dex token', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const keyFile = join(mkdtempSync(join(tmpdir(), 'zk-')), 'dev.pem');
    writeFileSync(keyFile, await exportPKCS8(privateKey));
    vi.stubEnv('ZARA_DEV_KEY_FILE', keyFile);
    vi.resetModules();
    const { setSession: ss } = await import('@/lib/session');
    const route = await import('@/app/bff/[...path]/route');
    await ss({
      exp: Date.now() + 3_600_000,
      sub: 'engineer-user',
      dev: { tenantId: 't-1', envs: ['dev'] },
    });
    const spy = stubUpstream();
    await route.GET(req('http://localhost:3400/bff/api/whoami'), ctx(['api', 'whoami']));
    const [, init] = spy.mock.calls[0]! as unknown as [string, RequestInit];
    const bearer = (init.headers as Headers).get('authorization')!;
    expect(bearer.startsWith('Bearer eyJ')).toBe(true); // JWT, not 'idp-token'
    expect(bearer).not.toContain('idp-token');
  });

  it('rejects oversized bodies before reading (declared length)', async () => {
    vi.stubEnv('ZARA_DEV_KEY_FILE', '');
    await setSession({ at: 'a', exp: Date.now() + 3_600_000, sub: 'u' });
    const spy = stubUpstream();
    const res = await POST(
      req('http://localhost:3400/bff/api/envs/dev/rules', {
        method: 'POST',
        headers: { 'content-length': String(2 * 1024 * 1024), 'content-type': 'application/json' },
        body: '{}',
      }),
      ctx(['api', 'envs', 'dev', 'rules']),
    );
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it('propagates upstream status codes', async () => {
    vi.stubEnv('ZARA_DEV_KEY_FILE', '');
    await setSession({ at: 'a', exp: Date.now() + 3_600_000, sub: 'u' });
    stubUpstream(403, { error: 'env uat not in permitted_environments' });
    const res = await GET(
      req('http://localhost:3400/bff/api/envs/uat/rules'),
      ctx(['api', 'envs', 'uat', 'rules']),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('permitted');
  });
});
