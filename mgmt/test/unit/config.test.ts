//! loadConfig — the fail-closed env parser. Every weakening default
//! would be invisible; the matrix is proven here.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const BASE = {
  MGMT_DATABASE_URL: 'postgres://zara_mgmt:x@localhost:5532/zara',
  OIDC_ISSUER: 'https://issuer.example',
};

describe('loadConfig', () => {
  it('fails closed without any auth source', () => {
    expect(() => loadConfig({ MGMT_DATABASE_URL: 'postgres://x' })).toThrow(/auth not configured/);
    // Auth guard passes but DSN absent → the required() check fires.
    expect(() => loadConfig({ OIDC_ISSUER: 'https://i' })).toThrow(/MGMT_DATABASE_URL is required/);
  });

  it('defaults: port, audience, rate limits; no kms without KMS_URL', () => {
    const c = loadConfig(BASE);
    expect(c.port).toBe(8401);
    expect(c.oidcAudience).toEqual(['zara-mgmt']);
    expect(c.rateLimitPerMin).toBe(120);
    expect(c.rateLimitMutationsPerMin).toBe(30);
    expect(c.rateLimitDisable).toBe(false);
    expect(c.rateLimitTrustXff).toBe(false);
    expect(c.kms).toBeUndefined();
    expect(c.staticJwks).toBeUndefined();
  });

  it('audience comma-splits; issuer + jwks url pass through', () => {
    const c = loadConfig({
      ...BASE,
      OIDC_AUDIENCE: 'zara-mgmt, zara-admin ',
      OIDC_JWKS_URL: 'https://issuer.example/jwks.json',
      PORT: '9500',
    });
    expect(c.oidcAudience).toEqual(['zara-mgmt', 'zara-admin']);
    expect(c.oidcJwksUrl).toBe('https://issuer.example/jwks.json');
    expect(c.port).toBe(9500);
  });

  it('static JWKS satisfies auth without an issuer; file variant reads disk', () => {
    const inline = loadConfig({ MGMT_DATABASE_URL: 'x', ZARA_JWKS_JSON: '{"keys":[]}' });
    expect(inline.staticJwks).toBe('{"keys":[]}');
    const dir = mkdtempSync(join(tmpdir(), 'jwks-'));
    const f = join(dir, 'jwks.json');
    writeFileSync(f, '{"keys":["k"]}');
    const fromFile = loadConfig({ MGMT_DATABASE_URL: 'x', ZARA_JWKS_FILE: f });
    expect(fromFile.staticJwks).toBe('{"keys":["k"]}');
  });

  it('rejects non-positive numeric overrides', () => {
    for (const [k, v] of [
      ['PORT', '0'],
      ['PORT', 'abc'],
      ['RATE_LIMIT_PER_MIN', '-5'],
      ['RATE_LIMIT_MUTATIONS_PER_MIN', '0'],
    ] as const) {
      expect(() => loadConfig({ ...BASE, [k]: v }), k).toThrow(/not a positive number/);
    }
  });

  it('kms block only with KMS_URL; defaults mount + keyName, honors overrides', () => {
    const c = loadConfig({ ...BASE, KMS_URL: 'http://bao:8200', KMS_TOKEN_FILE: '/run/bao/token' });
    expect(c.kms).toEqual({
      url: 'http://bao:8200',
      tokenFile: '/run/bao/token',
      mount: 'zara-transit',
      keyName: 'zara-mgmt-secrets',
    });
    const o = loadConfig({
      ...BASE,
      KMS_URL: 'http://bao:8200',
      KMS_TOKEN: 't',
      KMS_MOUNT: 'm2',
      KMS_KEY_NAME: 'k2',
    });
    expect(o.kms).toMatchObject({ token: 't', mount: 'm2', keyName: 'k2' });
    expect(o.kms).not.toHaveProperty('tokenFile');
  });

  it('rate-limit escape hatches are presence-based', () => {
    const c = loadConfig({ ...BASE, RATE_LIMIT_DISABLE: '0', RATE_LIMIT_TRUST_XFF: '0' });
    expect(c.rateLimitDisable).toBe(true); // presence, not truthiness
    expect(c.rateLimitTrustXff).toBe(true);
  });
});
