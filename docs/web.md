# Zara web console (Z5)

Next.js App Router BFF on `:3400` — the only browser-facing surface.
Thin client over the management API (`:8401`); the web never touches
Postgres or the engine, and access tokens never reach JavaScript.

## Auth flow

- **Dev:** Dex auth-code + PKCE (public client `zara-web` in
  `dex/config.dev.yaml`, redirect `http://localhost:3400/auth/callback`).
  `/auth/login` stashes verifier/state in short-lived httpOnly cookies and
  bounces to Dex; `/auth/callback` exchanges the code and seals the
  session into a JWE httpOnly cookie (`SESSION_SECRET` — required, no
  fallback). `/auth/logout` clears it.
- **Dev token exchange:** Dex proves identity but cannot inject the
  claims mgmt's deny-first contract requires (`tenant_id`,
  `permitted_environments`). When `ZARA_DEV_KEY_FILE` is set the BFF
  mints a fresh short-lived `zara-devtoken` bearer **per request** with
  the shared `.devkeys` private key — the same contract as
  `mgmt/scripts/devtoken.mjs`. Identity→claims mapping comes from
  `DEV_TENANT_ID`/`DEV_ENVS` defaults + `DEV_CLAIMS_MAP` per-email
  overrides; unmapped users fail closed at login.
- **Prod:** the real IdP injects claims natively (Auth0 Action / Okta
  hook); `ZARA_DEV_KEY_FILE` stays unset and the IdP access token is
  forwarded untouched.

## BFF

`/bff/[...path]` proxies same-origin calls to `${API_URL}/<path>` with
the session bearer attached server-side. Bodies are bounded at 1 MiB
(mgmt's own ceiling) on both declared length and actual read. Client
fetchers live in `src/lib/client.ts`; server components call mgmt
directly via `src/lib/api.ts`.

## Env gating

`/{env}` routes validate against `/api/whoami`'s `effectiveEnvs`
(claims ∩ role scope, resolved by mgmt). Unpermitted envs redirect to
the first effective env; zero effective envs land on `/no-access`. The
mgmt gate 403s regardless — the web layer just fails earlier and
friendlier.

## Run

```bash
cd web && npm ci
SESSION_SECRET=… API_URL=http://localhost:8401 \
  ZARA_DEV_KEY_FILE=.devkeys/dev.pem DEV_TENANT_ID=<acme-uuid> \
  npm run dev        # :3400
# or: docker compose --profile mgmt --profile web up -d
```

Dev logins (dex): `admin@zara.dev`/`admin123`,
`engineer@zara.dev`/`engineer123`, `releasemgr@zara.dev`/`releasemgr123`,
`auditor@zara.dev`/`auditor123`. Grants for these emails are seeded by
`seed/003_demo_grants.sql` (ACME; auditor also on Northstar).
