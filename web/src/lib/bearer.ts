//! Bearer resolution for the mgmt hop — the BFF's only credential
//! decision, kept in one place.
//!
//!   prod (no ZARA_DEV_KEY_FILE): forward the IdP access token — the real
//!     IdP injects tenant_id/permitted_environments natively.
//!   dev  (ZARA_DEV_KEY_FILE set): mint a fresh short-lived Zara-shaped
//!     token per request with the shared .devkeys private key — Dex has
//!     already proven the human's identity but cannot express Zara claims.

import 'server-only';

import { readFileSync } from 'node:fs';
import { importPKCS8, SignJWT } from 'jose';
import { devExchange as dx } from './config';
import type { SessionData } from './session';

export const DEV_EXCHANGE_ENABLED = dx.keyFile !== '';

type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;
let cachedKey: SigningKey | undefined;
async function signingKey(): Promise<SigningKey> {
  if (!cachedKey) {
    cachedKey = await importPKCS8(readFileSync(dx.keyFile, 'utf8'), 'RS256');
  }
  return cachedKey;
}

/** The bearer for an upstream mgmt call. Throws when the session lacks
 *  what the active mode needs — deny-first, never a weak fallback. */
export async function bearerFor(s: SessionData): Promise<string> {
  if (!DEV_EXCHANGE_ENABLED) {
    if (!s.at) throw new Error('session carries no access token');
    return s.at;
  }
  const dev = s.dev;
  if (!dev) {
    throw new Error('dev exchange enabled but session has no resolved claims');
  }
  return new SignJWT({
    tenant_id: dev.tenantId,
    permitted_environments: dev.envs,
    ...(s.email ? { email: s.email } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'dev-1' })
    .setIssuer(dx.iss)
    .setAudience(dx.aud)
    .setSubject(s.sub)
    .setIssuedAt()
    .setExpirationTime(`${dx.ttlSeconds}s`)
    .sign(await signingKey());
}
