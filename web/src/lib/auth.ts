//! Auth-code + PKCE flow against the OIDC issuer (dex in dev). Routes:
//!   GET /auth/login    → beginLogin → redirect to issuer
//!   GET /auth/callback → finishLogin → session + redirect
//!   GET /auth/logout   → clearSession → login
//! `OIDC_AUTHORIZE_URL` is browser-facing; `OIDC_TOKEN_URL` is where the
//! server exchanges codes — they differ inside compose (dex vs localhost).

import 'server-only';

import { cookies } from 'next/headers';
import { decodeJwt } from 'jose';
import { cfg, devExchange } from './config';
import { genChallenge, genState, genVerifier } from './pkce';
import {
  PKCE_COOKIE,
  STATE_COOKIE,
  cookieOpts,
  setSession,
  type DevClaims,
  type SessionData,
} from './session';
import { DEV_EXCHANGE_ENABLED } from './bearer';

/** Build the authorize URL and stash PKCE verifier + state in short-lived
 *  httpOnly cookies (state cookie also carries the post-login target). */
export async function beginLogin(next: string): Promise<string> {
  const verifier = genVerifier();
  const state = genState();
  const store = await cookies();
  store.set(PKCE_COOKIE, verifier, { ...cookieOpts, maxAge: 300 });
  store.set(STATE_COOKIE, `${state}|${next}`, { ...cookieOpts, maxAge: 300 });

  const url = new URL(cfg.oidcAuthorizeUrl);
  url.searchParams.set('client_id', cfg.oidcClientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile offline_access');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', genChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Exchange the callback code for tokens; seal the session; return the
 *  post-login path (still caller-re-validated — the cookie isn't signed). */
export async function finishLogin(code: string, state: string | null): Promise<string> {
  const store = await cookies();
  const verifier = store.get(PKCE_COOKIE)?.value;
  const [expected, next] = (store.get(STATE_COOKIE)?.value ?? '|').split('|');
  if (!verifier || !state || state !== expected) throw new Error('bad oauth state');

  const res = await fetch(cfg.oidcTokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.oidcClientId,
      redirect_uri: cfg.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  const tokens = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(`token exchange failed: ${tokens.error ?? res.status}`);

  const idClaims = tokens.id_token ? safeDecode(tokens.id_token) : {};
  const sub = (idClaims.sub as string) ?? '';
  if (!sub) throw new Error('id_token missing sub');

  const session: SessionData = {
    at: tokens.access_token,
    rt: tokens.refresh_token,
    exp: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    sub,
    ...(typeof idClaims.email === 'string' ? { email: idClaims.email } : {}),
    ...(DEV_EXCHANGE_ENABLED ? { dev: resolveDevClaims(idClaims) } : {}),
  };
  await setSession(session);
  store.delete(PKCE_COOKIE);
  store.delete(STATE_COOKIE);
  return next || '/';
}

function safeDecode(jwt: string): Record<string, unknown> {
  try {
    return decodeJwt(jwt) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Map the verified IdP identity to the Zara claims a prod IdP would
 *  inject. Fail closed: dev-exchange mode with no resolvable claims is a
 *  login error, never a silently-claimless token. */
function resolveDevClaims(idClaims: Record<string, unknown>): DevClaims {
  const email = typeof idClaims.email === 'string' ? idClaims.email : '';
  const entry = devExchange.claimsMap[email] ?? {};
  const tenantId = entry.tenantId ?? devExchange.tenantId;
  const envs = entry.envs ?? devExchange.envs;
  if (!tenantId || envs.length === 0) {
    throw new Error(
      `no dev claims for ${email || 'user'} — set DEV_TENANT_ID/DEV_ENVS or DEV_CLAIMS_MAP`,
    );
  }
  return { tenantId, envs };
}
