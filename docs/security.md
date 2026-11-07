# Security model

Zara's security posture is deny-first zero trust across three surfaces —
the Next.js web console (BFF), the Node.js management plane, and the Rust
evaluation engine. This doc collects the end-to-end reference operators
need: TLS per hop, the two OIDC flows, secrets handling, KMS rotation,
audit-chain verification, and the enumerated dev carve-outs.

Supporting runbooks: `docs/openbao-prod-runbook.md` (Shamir sealing, TLS,
HA, token lifecycle, break-glass), `docs/engine.md` §gRPC (EngineControl
contract + listener hardening), `docs/web.md` (auth/PKCE details).

## Trust boundaries

```
browser ──①──► web (BFF) ──②──► mgmt ──③──► engine (HTTP eval)
                  │               │            ▲
                  │               ├──④─────────┘ gRPC EngineControl
                  │               ├──⑤──► Postgres (app roles + RLS)
                  │               └──⑥──► OpenBao transit
                  └──────────────► dex (OIDC issuer)
```

## TLS per hop

| Hop | Dev | Production posture |
|---|---|---|
| ① browser→web | http on :3400 loopback | TLS 1.3 at the terminator; `PUBLIC_ORIGIN` pins redirect origin; `SESSION_SECURE=true` |
| ② web→mgmt | http inside the compose network | TLS 1.3; BFF injects the bearer — it never reaches JS |
| ③ consumer→engine | http on :8400 loopback | TLS 1.3 termination ahead of the engine |
| ④ mgmt→engine gRPC | h2c on :9443 | TLS 1.3 via `ENGINE_GRPC_TLS` + `GRPC_TLS_CERT`/`GRPC_TLS_KEY` seam |
| ⑤ mgmt→Postgres | plaintext inside the network | TLS + client certs per environment DSN; least-privilege roles |
| ⑥ mgmt→OpenBao | plaintext transit on :8320 | TLS 1.3 — see the OpenBao production runbook |

Dev carve-outs are deliberate and enumerated at the bottom of this doc —
each is a documented exception, not an accidental gap.

## OIDC flows

### Interactive (web console) — authorization code + PKCE

1. `/auth/login` generates a PKCE verifier/challenge + state (RFC 7636,
   `lib/pkce.ts`), stores verifier+state in sealed httpOnly cookies, and
   redirects to dex's authorization endpoint.
2. `/auth/callback` verifies state, exchanges the code for tokens at the
   IdP token endpoint, and seals the result (`at`/`rt`/`exp`/`sub`/`email`)
   into `zara_session` — an `EncryptJWT` (dir/A256GCM, key =
   sha256(`SESSION_SECRET`)) httpOnly, `sameSite=lax` cookie. `secure`
   is on in prod via `SESSION_SECURE`.
3. Every BFF call re-validates the session server-side and refreshes the
   access token inside `REFRESH_MARGIN` (30 s before exp) when a refresh
   token exists. The access token never reaches browser JS.

Redirect origin: `PUBLIC_ORIGIN` must be set in prod — without it the
callback derives the origin from Host/X-Forwarded-* headers (dev only;
MPE-174).

### Service-to-service — client credentials

Service tokens (mgmt→engine gRPC, CI callers) use dex client-credentials
clients (`zara-svc`, `zara-ci` in `dex/config.dev.yaml`). Token issuance
carries the claims Zara requires — `tenant_id`, `permitted_environments`,
`aud=zara-engine` — via the claims-seam documented in `docs/engine.md`
§gRPC. Issued tokens are mounted to consumers as files
(`ENGINE_GRPC_TOKEN_FILE`, `tokenFile` config) — never inline in env
blocks that could leak into `docker inspect` output.

Rotation: re-issue a token at the IdP, replace the mounted file, restart
the consumer. No token revocation list exists — rely on short token TTL
(configured at dex) plus file replacement.

## Token validation (both resource servers)

- Asymmetric algs only — `RS256`/`ES256`/`EdDSA`; `none` and symmetric
  confusion die before signature work (engine checks the header alg
  against an allowlist first; mgmt enforces the same set through `jose`).
- Required claims: `iss`, `aud`, `exp`, `nbf`, `sub`, `tenant_id`,
  non-empty `permitted_environments`. Wrong tenant or env → 403.
- JWKS fetched from `OIDC_JWKS_URL` or `<iss>/.well-known/openid-configuration`
  — operator-configured endpoints only (no request-derived URLs → no
  SSRF). Kid-refresh is bounded (300 s min interval engine-side) and
  every fetch is time-capped (10 s total / 5 s connect) so a hung IdP
  can't stall evals. `jose`'s remote set applies its own cooldown.
- Static JWKS (`ZARA_JWKS_JSON`/`ZARA_JWKS_FILE`) is a dev/test escape —
  it logs a loud warning at boot and must never reach prod (key rotation
  impossible; issuer still pinned).

## Tenant + environment isolation

- `tenant_id` is a verified claim in every token — never client input.
  mgmt stamps `set_config('zara.tenant_id', …, true)` inside every
  transaction (`withTenantTx`); FORCE RLS means no GUC = zero rows.
- The engine reads through `zara_engine` (SELECT-only) under the same
  GUC per tenant — no bypass role exists on the eval path.
- Environments are separate schemas (`zara_dev/qa/uat/prod`); promotion
  copies `DEV→QA→UAT→PROD` via the `zara_promote` role (SELECT+INSERT
  only) — no UPDATE/DELETE on published rows, no env skipping.
- Published artifacts are trigger-enforced immutable; every promotion
  records `sha256(graph)` + actor + timestamp.

## Secrets handling

- `tenant_secrets` stores `vault:vN:` envelopes only — AES-256-GCM via
  OpenBao transit. Plaintext exists solely inside the cipher seam
  (`kms/cipher.ts`); routes list metadata only, ciphertext never crosses
  the API boundary.
- KMS unset → every secrets route 503s. There is no insecure fallback.
- Transit token read from a mounted file (lazy, cached); OpenBao error
  bodies are never surfaced (they can echo ciphertext/policy detail).
- Repo hygiene: `.env` gitignored, compose fails closed on unset `${VAR:?}`,
  `.devkeys/` never committed, gitleaks runs in CI.
- PII at the eval boundary: `pii_guard` walks the scenario — field-name
  denylist + value-shape checks (SSN/9-digit/email); rejections carry the
  field path only.
- Logging: two layers — `maskDeep` denies by normalized key name at any
  depth (versioned `MASK_DENYLIST_VERSION`) plus pino `fast-redact` paths
  for transport carriers. Extend the list; never route around it.

## KMS rotation runbook

Envelope re-sealing (transit key version bump):

1. Rotate the transit key in OpenBao:
   `bao write -f transit/keys/<key-name>/rotate` (production procedure in
   `docs/openbao-prod-runbook.md` — token scope, seal state, quorum).
2. Re-seal every stored envelope under the latest version —
   `POST /api/admin/secrets/rewrap-all` (Release-Manager role) performs a
   per-row tx sweep: fresh ciphertext read → transit `rewrap` (no
   plaintext on the wire) → update + attributed audit row per secret.
   Idempotent; the response lists `rewrapped`/`failed` per name.
   Single-secret path: `POST /api/admin/secrets/{name}/rewrap`.
3. Verify — `GET /api/admin/secrets` and confirm `keyVersion` advanced
   on every row; confirm zero `failed` entries in the sweep response.

Key-compromise/decommission steps live in the OpenBao runbook.

## Audit-chain verification

Mutations write attributed, append-only rows into the tenant's audit
table inside the same tx that made them — `sha256(prev_hash ‖
canonical(event))` per row, serialized by an advisory lock. Chains are
per-tenant under RLS.

- Verify: `GET /api/admin/audit/verify` (RM) — recomputes linkage +
  content hash over `zara_control.audit_events` in id order; returns
  `{checked, ok, firstBadId?, reason?}` (`link break` / `hash mismatch`).
- Env-schema chains exist per environment for data-plane mutations;
  the same `record()`/`canonicalEvent()` machinery attests them.
- The admin console's `/admin/audit` page runs the same check and prints
  `Chain verified — N events, no breaks`.

## DoS posture

| Surface | Controls |
|---|---|
| engine :8400 | 256 KB body cap; 240 req/min per-IP bucket (`RATE_LIMIT_PER_MIN`) |
| engine :9443 gRPC | `GRPC_MAX_CONCURRENT_STREAMS` (128) + `GRPC_TIMEOUT_MS` per-RPC deadline |
| mgmt :8401 | 1 MiB body cap; global per-IP bucket + tighter mutation bucket |
| BFF | 1 MiB body bound before proxying (streams; 413 past the cap) |
| all | `RATE_LIMIT_TRUST_XFF` honors X-Forwarded-For only behind a rewriting proxy; `RATE_LIMIT_DISABLE` is a dev escape that warns at boot |
| JWKS fetch | bounded kid-refresh + 10 s/5 s fetch timeouts |

## Dev carve-outs (never prod)

- Plaintext hops inside the dev Docker network: web→mgmt, mgmt→engine
  h2c, mgmt→OpenBao, mgmt→Postgres.
- `ZARA_JWKS_JSON`/`ZARA_JWKS_FILE` static JWKS + `.devkeys/` devtoken
  (issuer check still applies; no key rotation possible).
- `DEV_CLAIMS_MAP`/`DEV_TENANT_ID` dev-claims exchange in the web session
  path (replaced by real IdP claims in passthrough mode).
- `SESSION_SECURE` unset → session cookie without `Secure` for http
  loopback.
- `RATE_LIMIT_DISABLE`, `RATE_LIMIT_TRUST_XFF` toggles.
- Dex on http://localhost:5656 (dev issuer), plaintext OpenBao :8320.
