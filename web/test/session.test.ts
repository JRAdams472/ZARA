import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
}));

import {
  SESSION_COOKIE,
  clearSession,
  isLive,
  readSession,
  setSession,
  type SessionData,
} from '@/lib/session';

const live: SessionData = {
  at: 'idp-token',
  exp: Date.now() + 3_600_000,
  sub: 'engineer-user',
  email: 'engineer@zara.dev',
};

beforeEach(() => jar.clear());

describe('session cookie', () => {
  it('seals and reads back a session round-trip', async () => {
    await setSession(live);
    expect(jar.get(SESSION_COOKIE)).toBeTruthy();
    // JWE compact serialization — 5 segments.
    expect(jar.get(SESSION_COOKIE)!.split('.')).toHaveLength(5);
    const s = await readSession();
    expect(s?.sub).toBe('engineer-user');
    expect(s?.at).toBe('idp-token');
  });

  it('rejects a tampered cookie', async () => {
    await setSession(live);
    const sealed = jar.get(SESSION_COOKIE)!;
    jar.set(SESSION_COOKIE, `${sealed.slice(0, -4)}AAAA`);
    expect(await readSession()).toBeNull();
  });

  it('returns null with no cookie', async () => {
    expect(await readSession()).toBeNull();
  });

  it('clearSession drops the cookie', async () => {
    await setSession(live);
    await clearSession();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
});

describe('isLive', () => {
  it('live session passes', () => {
    expect(isLive(live)).toBe(true);
  });
  it('null session fails', () => {
    expect(isLive(null)).toBe(false);
  });
  it('expired with no refresh token fails', () => {
    expect(isLive({ ...live, exp: Date.now() - 60_000 })).toBe(false);
  });
  it('expired with a refresh token stays live (route refresh path)', () => {
    expect(isLive({ ...live, exp: Date.now() - 60_000, rt: 'refresh' })).toBe(true);
  });
  it('dev session obeys exp only', () => {
    const dev: SessionData = { ...live, dev: { tenantId: 't', envs: ['dev'] } };
    expect(isLive(dev)).toBe(true);
    expect(isLive({ ...dev, exp: Date.now() - 1 })).toBe(false);
  });
});
