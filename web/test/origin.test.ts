import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// config.ts reads PUBLIC_ORIGIN at import time, so each test re-imports
// a fresh module under its own env — same pattern as bearer.test.ts.
async function freshOrigin() {
  vi.resetModules();
  return await import('@/lib/origin');
}

function req(headers: Record<string, string>, nextHost = '0.0.0.0:3400') {
  return {
    headers: { get: (n: string) => headers[n] ?? null },
    nextUrl: { host: nextHost },
  } as NextRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requestOrigin', () => {
  it('PUBLIC_ORIGIN set → pinned origin wins over every header', async () => {
    vi.stubEnv('PUBLIC_ORIGIN', 'https://zara.example.com/');
    const { requestOrigin } = await freshOrigin();
    expect(
      requestOrigin(req({ host: 'evil.example', 'x-forwarded-host': 'evil.example' })),
    ).toBe('https://zara.example.com');
  });

  it('unset → forwarded host + proto win, then host, then nextUrl', async () => {
    vi.stubEnv('PUBLIC_ORIGIN', '');
    const { requestOrigin } = await freshOrigin();
    expect(
      requestOrigin(req({ 'x-forwarded-host': 'zara.local', 'x-forwarded-proto': 'https' })),
    ).toBe('https://zara.local');
    expect(requestOrigin(req({ host: 'zara.local' }))).toBe('http://zara.local');
    expect(requestOrigin(req({}))).toBe('http://0.0.0.0:3400');
  });

  it('malformed PUBLIC_ORIGIN fails closed at import', async () => {
    vi.stubEnv('PUBLIC_ORIGIN', 'not a url');
    await expect(freshOrigin()).rejects.toThrow('PUBLIC_ORIGIN');
    vi.stubEnv('PUBLIC_ORIGIN', 'ssh://zara.example.com');
    await expect(freshOrigin()).rejects.toThrow('PUBLIC_ORIGIN');
  });
});
