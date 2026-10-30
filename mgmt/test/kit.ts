//! Test signing material + app factory. RSA key is generated per run —
//! test-only, guards nothing.

import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { JwtValidator } from '../src/auth/jwks.js';
import type { Config } from '../src/config.js';

export const ISSUER = 'https://test-issuer.invalid';
export const AUDIENCE = 'zara-mgmt';
export const ACME = 'aa5ce000-0000-4000-8000-0000000000ac';
export const NORTHSTAR = 'bb0215a0-0000-4000-8000-0000000000b2';

export const TEST_CONFIG: Config = {
  port: 0,
  databaseUrl: process.env.MGMT_DATABASE_URL ?? '',
  oidcAudience: [AUDIENCE],
  rateLimitPerMin: 10_000,
  rateLimitMutationsPerMin: 10_000,
  rateLimitDisable: true,
  rateLimitTrustXff: false,
};

export interface Kit {
  app: FastifyInstance;
  sql: postgres.Sql;
  mint: (opts: MintOpts) => Promise<string>;
}

interface MintOpts {
  tenantId?: string;
  envs?: string[];
  sub?: string;
  ttlSecs?: number;
  alg?: 'RS256' | 'HS256';
  iss?: string;
}

export async function makeKit(): Promise<Kit | undefined> {
  const dsn = process.env.MGMT_DATABASE_URL;
  if (!dsn) return undefined; // caller skips
  const sql = postgres(dsn, { max: 4 });
  const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-1';
  jwk.use = 'sig';
  jwk.alg = 'RS256';
  const validator = JwtValidator.forStatic(JSON.stringify({ keys: [jwk] }), {
    issuer: ISSUER,
    audience: [AUDIENCE],
  });
  const app = await buildApp(TEST_CONFIG, { sql, validator });
  const signing = privateKey; // jose signs with the CryptoKey directly

  const mint = async (o: MintOpts) => {
    const jwt = new SignJWT({
      tenant_id: o.tenantId ?? ACME,
      permitted_environments: o.envs ?? ['dev'],
    })
      .setProtectedHeader({ alg: o.alg ?? 'RS256', kid: 'test-1' })
      .setIssuer(o.iss ?? ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(o.sub ?? 'test-subject')
      .setIssuedAt()
      .setExpirationTime(`${o.ttlSecs ?? 3600}s`);
    if (o.alg === 'HS256') {
      return jwt.sign(new TextEncoder().encode('whatever-secret'));
    }
    return jwt.sign(signing);
  };
  return { app, sql, mint };
}
