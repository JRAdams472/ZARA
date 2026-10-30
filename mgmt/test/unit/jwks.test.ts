//! JwtValidator construction paths — the remote/discovery surface that
//! integration tests don't reach (they use forStatic). fetchFn seam
//! keeps the network out of the unit suite.

import { describe, expect, it, vi } from 'vitest';
import { JwtValidator } from '../../src/auth/jwks.js';

const OPTS = { issuer: 'https://issuer.example', audience: ['zara-mgmt'] };

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

describe('JwtValidator.connect', () => {
  it('explicit jwks url skips discovery entirely', async () => {
    const fetchFn = vi.fn();
    const v = await JwtValidator.connect(
      'https://issuer.example',
      OPTS.audience,
      'https://issuer.example/jwks.json',
      fetchFn,
    );
    expect(v).toBeInstanceOf(JwtValidator);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('discovers jwks_uri from the issuer well-known doc', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string | URL) => {
      calls.push(String(url));
      return okJson({ jwks_uri: 'https://issuer.example/disc-jwks.json' });
    };
    const v = await JwtValidator.connect(
      'https://issuer.example/',
      OPTS.audience,
      undefined,
      fetchFn as typeof fetch,
    );
    expect(v).toBeInstanceOf(JwtValidator);
    // trailing-slash normalized, discovery path appended
    expect(calls[0]).toBe('https://issuer.example/.well-known/openid-configuration');
  });

  it('fails closed on non-OK discovery and missing jwks_uri', async () => {
    const failing = async () => new Response('nope', { status: 503 });
    await expect(
      JwtValidator.connect('https://i', OPTS.audience, undefined, failing as typeof fetch),
    ).rejects.toThrow(/OIDC discovery failed/);
    const emptyDoc = async () => okJson({});
    await expect(
      JwtValidator.connect('https://i', OPTS.audience, undefined, emptyDoc as typeof fetch),
    ).rejects.toThrow(/jwks_uri/);
  });
});

describe('JwtValidator.forStatic', () => {
  it('parses a JWKS document', () => {
    const v = JwtValidator.forStatic('{"keys":[]}', OPTS);
    expect(v).toBeInstanceOf(JwtValidator);
  });
  it('malformed JSON throws at construction', () => {
    expect(() => JwtValidator.forStatic('not-json', OPTS)).toThrow();
  });
});
