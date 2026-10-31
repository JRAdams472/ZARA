//! Server-side session — tokens sealed into an httpOnly JWE cookie
//! (dir/A256GCM, key = sha256(SESSION_SECRET)). No fallback secret: a
//! compiled-in default would let anyone forge sessions. The browser only
//! ever sees the sealed cookie — access tokens never reach JS.

import 'server-only';

import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cfg } from './config';

export const SESSION_COOKIE = 'zara_session';
export const PKCE_COOKIE = 'zara_pkce';
export const STATE_COOKIE = 'zara_state';
/** Refresh this far before the access-token exp, ms. */
const REFRESH_MARGIN = 30_000;

/** Dev-mode identity: the claims a prod IdP would inject into the token.
 *  Resolved at login from DEV_CLAIMS_MAP / DEV_TENANT_ID fallbacks. */
export interface DevClaims {
  tenantId: string;
  envs: string[];
}

export interface SessionData {
  /** IdP access token — the mgmt bearer in passthrough mode. Unused when
   *  the dev exchange mints per request. */
  at?: string;
  /** IdP refresh token (offline_access). */
  rt?: string;
  /** Access-token expiry, epoch ms. */
  exp: number;
  sub: string;
  email?: string;
  /** Resolved dev claims — present only in dev-exchange mode. */
  dev?: DevClaims;
}

export const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: cfg.sessionSecure,
  path: '/',
};

function sessionKey(): Buffer {
  if (!cfg.sessionSecret) {
    throw new Error('SESSION_SECRET is required — set it in .env (see .env.example)');
  }
  return createHash('sha256').update(cfg.sessionSecret).digest();
}

export async function setSession(s: SessionData): Promise<void> {
  const sealed = await new EncryptJWT(s as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .encrypt(sessionKey());
  (await cookies()).set(SESSION_COOKIE, sealed, { ...cookieOpts, maxAge: 60 * 60 * 12 });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Read + decrypt the session cookie. Returns the raw session — refresh
 *  of the IdP token (passthrough mode) is handled in getSession(). */
export async function readSession(): Promise<SessionData | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    return (await jwtDecrypt(raw, sessionKey())).payload as unknown as SessionData;
  } catch {
    return null;
  }
}

/** Read-side liveness check — for server components that cannot write
 *  cookies (refresh is a Route Handler concern). A dead session is treated
 *  as unauthenticated; the login flow overwrites the cookie anyway. */
export function isLive(s: SessionData | null): s is SessionData {
  if (!s) return false;
  return s.dev ? s.exp > Date.now() : Date.now() < s.exp - REFRESH_MARGIN || !!s.rt;
}

/** Current session — in passthrough mode, refreshes the IdP access token
 *  when close to expiry and a refresh token exists. Dev-exchange mode
 *  mints its bearer per request, so only the identity must be live.
 *  Route Handlers / Server Actions only — it may write cookies. */
export async function getSession(): Promise<SessionData | null> {
  const s = await readSession();
  if (!s) return null;
  if (s.dev) return s.exp > Date.now() ? s : null;
  if (Date.now() < s.exp - REFRESH_MARGIN) return s;
  if (!s.rt) return null;

  const res = await fetch(cfg.oidcTokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cfg.oidcClientId,
      refresh_token: s.rt,
    }),
  });
  if (!res.ok) return null;
  const t = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const refreshed: SessionData = {
    ...s,
    at: t.access_token,
    rt: t.refresh_token ?? s.rt,
    exp: Date.now() + (t.expires_in ?? 3600) * 1000,
  };
  await setSession(refreshed);
  return refreshed;
}
