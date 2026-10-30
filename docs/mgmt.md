# Management plane (Z3, MPE-143 / MPE-156 + MPE-157)

Node.js/TypeScript gatekeeper service on **`:8401`** — the control-plane
surface for tenant RBAC, environment authorization, the append-only
audit chain, and KMS-sealed tenant secrets. JDM editing (Z4), promotion
(Z4), and the UI (Z5) build on the gate this milestone establishes.

## Layout

```
mgmt/
  src/
    config.ts           env parsing — fail-closed, no weakening defaults
    app.ts / server.ts  Fastify wiring + entrypoint (1 MB body cap, pino)
    auth/
      jwks.ts           jose validator — RS256/ES256/EdDSA only
      principal.ts      verified claims → Principal + DB role resolution
      roles.ts          role→env scope map (versioned in code, ADR-0005)
    db/
      pool.ts           postgres.js pool + withTenantTx (RLS GUC)
      tenants.ts        slug → tenant id
      grants.ts         role_grants CRUD (tx-scoped, MPE-120 port)
      audit.ts          hash-chained append-only audit (MPEx port)
      secrets.ts        tenant_secrets — ciphertext-only persistence
    kms/
      cipher.ts         FieldCipher seam + vault:vN: envelope grammar (ADR-0003)
      transit.ts        OpenBao transit adapter (LOLA port, fetch-based)
      index.ts          createCipher — undefined when KMS_URL unset → 503
    log/
      mask.ts           recursive denylist masker (versioned, ADR-0005)
      redact.ts         pino LOG_REDACT paths + LOG_FORMATTERS denylist walk
    redact/
      secrets.ts        role→field visibility map at serialization
    plugins/
      auth.ts           deny-first gate + auth.denied audit writer
      errors.ts         HttpError → status mapping
      security.ts       response header hardening
      rateLimit.ts      per-IP global + mutation buckets
    routes/             healthz, whoami, envs, admin/grants, admin/audit,
                        admin/secrets
  scripts/
    devtoken.mjs        ephemeral-key dev JWT minter (jose, .devkeys)
    audit.mjs           filtered npm-audit gate (MPE-123 pattern)
  test/                 unit (roles, chain math) + inject() integration
```

## Auth model

Deny-first, in order:

1. Missing/malformed/invalid token → **401**. Verification via `jose`
   (`jwtVerify`) with the asymmetric alg allowlist — `none`/HS* die at
   signature checks. `iss`, `aud`, `exp`, `nbf`, `sub` all enforced.
2. `tenant_id` claim resolves the tenant; roles come **only** from
   `zara_control.role_grants` (the IdP never knows Zara roles), cached
   ~30 s. A token for a tenant where the subject holds no grants gets
   zero roles — foreign-tenant access 403s on any role-gated route.
3. `/api/envs/{env}/…` requires `env ∈ permitted_environments` claim.
4. …and `env` must be inside the resolved role's scope — the effective
   set is the *intersection*, so an auditor's `prod` claim still 403s.
5. Route-level role requirements (`admin/*` → `tenant_release_manager`).

Authenticated-but-insufficient denials write an `auth.denied` audit row
(attributed, tenant-chained). Absent/bad tokens only log — no unbounded
audit writes for unauthenticated traffic.

### Roles (MPE-113)

| Role | dev | qa | uat | prod |
|---|---|---|---|---|
| `tenant_auditor` | — | read | read | — |
| `tenant_rule_engineer` | write | read | read | — |
| `tenant_release_manager` | write | write | write | write |

## Endpoints

| Method/Path | Role | Purpose |
|---|---|---|
| `GET /healthz` | — | liveness (unauthenticated) |
| `GET /api/whoami` | any grant | claims + resolved roles + env capability matrix |
| `GET /api/envs/{env}/context` | scoped | env authorization surface — the gate's 403 probe |
| `GET /api/admin/grants` | RM | list tenant grants |
| `PUT /api/admin/grants` | RM | upsert `{subjectType, subject, role}` — audited |
| `DELETE /api/admin/grants/:id` | RM | revoke — refuses the tenant's last RM |
| `GET /api/admin/audit` | RM | chain tail (`?limit=`, ≤200) |
| `GET /api/admin/audit/verify` | RM | recompute linkage + hashes |
| `GET /api/admin/secrets` | RM/Eng | metadata list — RM sees `keyVersion`+`updatedBy`; Engineer minus `updatedBy`; Auditor **403** |
| `PUT /api/admin/secrets/:name` | RM | encrypt → upsert ciphertext — audited `secret.put` |
| `POST /api/admin/secrets/:name/rewrap` | RM | transit rewrap under latest key version — audited `secret.rewrap` |

Grant writes and their audit rows commit in the **same** tenant-scoped
transaction — a mutation can never commit without its attestation.

## KMS seam + secrets (ADR-0003)

`tenant_secrets` rows hold **`vault:vN:` envelopes verbatim** plus the
transit `key_name` — plaintext never enters the database, and ciphertext
never leaves the db layer:

- `PUT` encrypts through `FieldCipher` **outside** the transaction (no
  plaintext lifetime extension, no KMS call holding a DB lock), then
  upserts ciphertext + audit in one tx.
- `GET` serializes metadata per the role→field map
  (`redact/secrets.ts`); `keyVersion` is parsed from the envelope inside
  the serializer — the envelope itself is never emitted.
- `rewrap` calls transit rewrap inside OpenBao — plaintext never crosses
  the wire during key rotation.
- **Unset `KMS_URL` → every secrets route answers 503.** There is no
  insecure local fallback; the rest of the service is unaffected.

Dev KMS is **OpenBao** (LOLA convention): `openbao/config/openbao.hcl`
(raft storage) + `openbao/init.sh` — init 1-of-1, unseal, `zara-transit`
mount, the `zara-mgmt-secrets` AES-256-GCM key (created as root so the
service token needs no key admin), a crypto-ops-only `zara-mgmt` policy
(`encrypt`/`decrypt`/`rewrap` + `sys/seal-status` — verified 403 on
`keys/*` and `sys/mounts`), and a scoped token into gitignored
`./data/openbao/api-token`. Production swaps the adapter behind
`FieldCipher` for a cloud KMS — routes and persistence don't change.

## Masking + RBAC redaction (ADR-0005)

Two layers, both versioned in code (config typos can't unmask):

- `log/mask.ts` — recursive denylist walker; `ssn`, `tax_id`,
  `client_name`, and credential-shaped keys (`password`, `secret`,
  `token`, `api_key`, `credential*`, `authorization`, `cookie`…) →
  `[MASKED]`. Normalized matching covers `camelCase`/`snake_case`.
- `log/redact.ts` — `LOG_REDACT` pino paths (transport carriers +
  denylist spellings) and `LOG_FORMATTERS`, which runs the walker over
  every logged object so nesting can't dodge the paths.
- `redact/secrets.ts` — role→field visibility at serialization (the
  proof surface: RM full / Engineer minus `updatedBy` / Auditor 403).

## Audit chain (per-tenant, append-only)

`zara_control.audit_events`: each row hashes
`sha256(prev_hash || "|" || canonical_event)` where the canonical event
is `occurredAt` (ISO-8601 ms, UTC — a pure function of the stored
`timestamptz`, so column precision can't desync the chain), `actorSub`,
`action`, `detail` (recursive sorted-key JSON). Writers serialize through
`pg_advisory_xact_lock` so `prev_hash` always points at the committed
tail. The table grants `INSERT`/`SELECT` only — UPDATE/DELETE die on
privilege, and a `BEFORE UPDATE OR DELETE` trigger rejects them even for
the owner. Per-tenant chains under FORCE RLS: each tenant's trail is
independently tamper-evident (a documented strengthening over MPEx's
single chain).

## DB role: `zara_mgmt`

Least privilege, provisioned by `bootstrap/0004` +
`--set-role-passwords` (`ZARA_MGMT_PASSWORD`):

- `USAGE` on `zara_control` only — env schemas are unreachable.
- `SELECT` on `tenants`, `environments`; `SELECT`+DML on `role_grants`;
  `INSERT`+`SELECT` on `audit_events`; `SELECT`+`INSERT`/`UPDATE` on
  `tenant_secrets` (Phase 2 surface).
- **No** default privileges, no migration-ledger access.
- FORCE RLS on all three tables via the `zara.tenant_id` GUC —
  `withTenantTx` stamps it per transaction; there is no unscoped path.

## Configuration

| Var | Meaning |
|---|---|
| `MGMT_DATABASE_URL` | `zara_mgmt` DSN (required) |
| `PORT` | listen port (default `8401`) |
| `OIDC_ISSUER` | expected `iss` — required unless static JWKS |
| `OIDC_AUDIENCE` | accepted `aud`, comma-separated (default `zara-mgmt`) |
| `OIDC_JWKS_URL` | explicit JWKS URL; unset → OIDC discovery |
| `ZARA_JWKS_FILE` / `ZARA_JWKS_JSON` | dev/test static JWKS — never prod |
| `RATE_LIMIT_PER_MIN` / `RATE_LIMIT_MUTATIONS_PER_MIN` | buckets (120/30) |
| `RATE_LIMIT_DISABLE` / `RATE_LIMIT_TRUST_XFF` | escape hatches — XFF only behind a proxy that overwrites it |
| `LOG_LEVEL` | pino level (default `info`) |
| `KMS_URL` | OpenBao base URL — unset → secrets routes 503 |
| `KMS_TOKEN_FILE` | scoped-token file (`data/openbao/api-token` via init) |
| `KMS_TOKEN` | inline token alternative — test/CI convenience only |
| `KMS_MOUNT` / `KMS_KEY_NAME` | transit mount + key (`zara-transit` / `zara-mgmt-secrets`) |

## Dev loop

```bash
cd mgmt && npm ci

# Dev token + JWKS (ephemeral keys, gitignored .devkeys/)
node scripts/devtoken.mjs --tenant-id <acme-uuid> --envs dev,qa,uat,prod \
  --sub <your-sub> --aud zara-mgmt \
  --jwks-out ../.devkeys/jwks.json --key-out ../.devkeys/dev.pem

MGMT_DATABASE_URL=postgres://zara_mgmt:…@localhost:5532/zara \
ZARA_JWKS_FILE=.devkeys/jwks.json OIDC_ISSUER=zara-devtoken \
  npm run dev          # tsx watch
# or: npm run build && node dist/server.js
```

The service itself mints no grants — seed a `tenant_release_manager`
grant for your `sub` first (see `test/kit.ts` for the shape), otherwise
every admin route 403s.

Compose (runs the built image after `--profile setup`):

```bash
docker compose --profile setup --profile mgmt up -d --build
```

## Verification

```bash
cd mgmt
npm run lint && npm run typecheck && npm test && npm run build
npm run coverage && npm run coverage:check  # 80%/area floor (covercheck)
npm run audit:gate          # production dep gate (MPE-123 pattern)
```

`npm test` runs unit tests always; the integration suite
(`fastify.inject` + real Postgres under the `zara_mgmt` role) activates
when `MGMT_DATABASE_URL` is set — `MIGRATE_DATABASE_URL` additionally
enables the owner-level append-only trigger proof. The cipher-backed
secrets cases additionally gate on `KMS_URL` + `KMS_TOKEN_FILE` (dev
OpenBao on `:8320` after `docker compose --profile setup up`); the
unset-KMS 503 and role-denial paths run with Postgres alone.
