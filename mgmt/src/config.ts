//! Service configuration from env — fail-closed: missing required values
//! abort startup; no defaults that would silently weaken auth or limits.

import { readFileSync } from 'node:fs';

export interface Config {
  port: number;
  /** DSN for the `zara_mgmt` role — control-schema grants/secrets/audit. */
  databaseUrl: string;
  /** Expected token issuer — required unless a static JWKS is set. */
  oidcIssuer?: string;
  /** Accepted `aud` values. */
  oidcAudience: string[];
  /** Explicit JWKS URL; unset → OIDC discovery on the issuer. */
  oidcJwksUrl?: string;
  /** Dev/test escape: static JWKS document (inline JSON or file contents). */
  staticJwks?: string;
  rateLimitPerMin: number;
  rateLimitMutationsPerMin: number;
  rateLimitDisable: boolean;
  rateLimitTrustXff: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name}: not a positive number`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const staticJwks =
    env.ZARA_JWKS_JSON ??
    (env.ZARA_JWKS_FILE ? readFileSync(env.ZARA_JWKS_FILE, 'utf8') : undefined);
  const oidcIssuer = env.OIDC_ISSUER;
  if (!staticJwks && !oidcIssuer) {
    throw new Error(
      'auth not configured: set OIDC_ISSUER (prod) or ZARA_JWKS_JSON/ZARA_JWKS_FILE (dev/test only)',
    );
  }
  if (staticJwks) {
    // Warned at startup in server.ts — dev/test only, never prod.
  }
  return {
    port: num(env, 'PORT', 8401),
    databaseUrl: required('MGMT_DATABASE_URL'),
    ...(oidcIssuer ? { oidcIssuer } : {}),
    oidcAudience: (env.OIDC_AUDIENCE ?? 'zara-mgmt')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ...(env.OIDC_JWKS_URL ? { oidcJwksUrl: env.OIDC_JWKS_URL } : {}),
    ...(staticJwks ? { staticJwks } : {}),
    rateLimitPerMin: num(env, 'RATE_LIMIT_PER_MIN', 120),
    rateLimitMutationsPerMin: num(env, 'RATE_LIMIT_MUTATIONS_PER_MIN', 30),
    rateLimitDisable: 'RATE_LIMIT_DISABLE' in env,
    rateLimitTrustXff: 'RATE_LIMIT_TRUST_XFF' in env,
  };
}
