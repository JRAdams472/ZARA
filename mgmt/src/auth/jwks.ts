//! JWT resource-server validation via jose — asymmetric alg allowlist
//! (RS256/ES256/EdDSA) enforced by jwtVerify itself, so `none`/HS* die at
//! signature verification. Two construction paths: `connect` (remote JWKS
//! via explicit URL or OIDC discovery, auto-refresh on rotation) and
//! `forStatic` (dev/test JWKS document, no network).

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyOptions,
  type JWTVerifyResult,
} from 'jose';

const ALLOWED_ALGS = ['RS256', 'ES256', 'EdDSA'] as const;

export interface VerifyOpts {
  issuer?: string;
  audience: string[];
}

export class JwtValidator {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet>;
  private readonly opts: JWTVerifyOptions;

  private constructor(
    jwks: JwtValidator['jwks'],
    { issuer, audience }: VerifyOpts,
  ) {
    this.jwks = jwks;
    this.opts = {
      algorithms: [...ALLOWED_ALGS],
      audience,
      ...(issuer ? { issuer } : {}),
      clockTolerance: 60,
    };
  }

  /** Remote JWKS: explicit URL or `iss/.well-known/openid-configuration`. */
  static async connect(
    issuer: string,
    audience: string[],
    jwksUrl?: string,
    fetchFn: typeof fetch = fetch,
  ): Promise<JwtValidator> {
    let url = jwksUrl;
    if (!url) {
      const res = await fetchFn(
        `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
      );
      if (!res.ok) throw new Error(`OIDC discovery failed: ${String(res.status)}`);
      const doc = (await res.json()) as { jwks_uri?: string };
      if (!doc.jwks_uri) throw new Error('discovery doc lacks jwks_uri');
      url = doc.jwks_uri;
    }
    return new JwtValidator(createRemoteJWKSet(new URL(url)), { issuer, audience });
  }

  /** Static JWKS for dev/test — issuer still pinned when configured. */
  static forStatic(jwksJson: string, opts: VerifyOpts): JwtValidator {
    const jwks = createLocalJWKSet(JSON.parse(jwksJson) as JSONWebKeySet);
    return new JwtValidator(jwks, opts);
  }

  async verify(token: string): Promise<JWTVerifyResult> {
    return jwtVerify(token, this.jwks, this.opts);
  }
}
