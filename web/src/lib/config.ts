//! Server-side config — fail closed; dev defaults are for compose only.

export const cfg = {
  mgmtUrl: process.env.API_URL ?? 'http://localhost:8401',
  oidcClientId: process.env.OIDC_CLIENT_ID ?? 'zara-web',
  oidcAuthorizeUrl:
    process.env.OIDC_AUTHORIZE_URL ?? 'http://localhost:5656/dex/auth',
  oidcTokenUrl:
    process.env.OIDC_TOKEN_URL ?? 'http://localhost:5656/dex/token',
  oidcJwksUrl: process.env.OIDC_JWKS_URL ?? 'http://localhost:5656/dex/keys',
  redirectUri:
    process.env.OIDC_REDIRECT_URI ?? 'http://localhost:3400/auth/callback',
  sessionSecret: process.env.SESSION_SECRET ?? '',
  sessionSecure: 'SESSION_SECURE' in process.env,
} as const;

//! Dev token exchange (never prod). Dex proves the user's identity but
//! cannot inject the claims mgmt's deny-first contract requires
//! (tenant_id, permitted_environments). When ZARA_DEV_KEY_FILE is set
//! the BFF mints a short-lived Zara-shaped token with the shared dev
//! private key — the same mechanism as mgmt/scripts/devtoken.mjs. In
//! prod the real IdP injects claims natively and this stays unset →
//! the IdP access token is forwarded untouched.

export const devExchange = {
  /** Dev signing key (PKCS8 PEM) — presence selects exchange mode. */
  keyFile: process.env.ZARA_DEV_KEY_FILE ?? '',
  /** Issuer the .devkeys JWKS contract expects. */
  iss: process.env.ZARA_TOKEN_ISSUER ?? 'zara-devtoken',
  /** Bearer audience for the management plane. */
  aud: process.env.ZARA_TOKEN_AUDIENCE ?? 'zara-mgmt',
  /** Minted token TTL — short; the BFF re-mints per request. */
  ttlSeconds: Number(process.env.ZARA_TOKEN_TTL ?? '120'),
  /** Per-email overrides: {"<email>": {"tenantId": "...","envs":[...]}} */
  claimsMap: safeJson(process.env.DEV_CLAIMS_MAP) as Record<
    string,
    { tenantId?: string; envs?: string[] }
  >,
  /** Defaults for users without a map entry. */
  tenantId: process.env.DEV_TENANT_ID ?? '',
  envs: (process.env.DEV_ENVS ?? 'dev,qa,uat,prod')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

function safeJson(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
