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

## Rule editor

`/{env}/rules/{key}` embeds the GoRules `@gorules/jdm-editor`
(`src/components/DecisionEditor*.tsx` — `next/dynamic`, `ssr: false`;
the editor internals are browser-only). The working-copy model is
mgmt's: drafts are mutable DEV working copies, published rows are
immutable revisions, and detail lookup prefers the draft when both
exist. `RuleEditor.tsx` offers Save draft / Publish / Delete draft /
New draft from published — DEV + write-role only; published and
non-DEV views are read-only. Publish surfaces the returned full
sha256; mgmt errors (PII paths, duplicate-key 409) render verbatim.

## Promotion UI

Published rows carry a Promote affordance whose target is derived
(`dev→qa→uat→prod` — skipping is inexpressible) and role-gated to
match mgmt `canPromote`: engineers promote ≤UAT, release managers
through PROD sign-off, auditors never. The confirm dialog shows the
graph sha256; the result snackbar reports the `published`
engine-push flag (ADR-0004 — `false` means the poller converges).
History lives at `/{env}/promotions` with actor + graph sha per row.

## Tenant admin (RM only)

`/admin/grants` — list/create/revoke role grants; the server's
last-release-manager refusal renders verbatim. `/admin/audit` —
control-plane event tail with the hash-chain verify verdict
(`Chain verified — N events, no breaks`). A dedicated admin layout
renders an explicit restriction for direct non-RM access; the nav
section is hidden for everyone else. Both are cosmetic gates —
mgmt's RM middleware 403s regardless.

## E2E

`web/e2e/` runs Playwright (MPEx convention) against the seeded
stack: per-persona dex logins saved as storage states, then
engineer promote flow, auditor read-only assertions, RM PROD
sign-off + admin screens.

```bash
npm run test:e2e    # expects the stack up (webServer starts `next start` if free)
```

CI reproduces the whole environment in the `e2e` job: postgres +
openbao services, migrations, demo seeds, transit provisioning,
devkeys, dex, mgmt, web.

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
