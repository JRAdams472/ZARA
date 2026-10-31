# Zara execution engine — service guide (Z2)

`zara-engine` is the Rust calculation plane: it evaluates published fee
rules (JDM graphs) for one `(environment, tenant)` partition per request,
behind JWT auth, per-IP rate limits, and a PII-free eval boundary
(ADR-0001, ADR-0005).

## Surface

| Route | Auth | Purpose |
|---|---|---|
| `GET /healthz` | none | liveness + DB ping (`{"status":"ok","db":"up"}`) |
| `POST /api/evaluate/{env}` | bearer JWT | evaluate the scenario against the tenant's published snapshot |

`{env}` ∈ `dev|qa|uat|prod` and must appear in the token's
`permitted_environments` claim — anything else is `403`; an unknown env is
`400`.

### Request

```json
{
  "tenantId": "acme-mortgage",           // slug or UUID — must equal tenant_id claim
  "scenario": { "loan": {...}, "borrower": {...} }
}
```

Response — the `EvalReport` shape:

```json
{
  "fees": [{
    "artifact": "origination-base",
    "feeCode": "origination",
    "tridBucket": "A",
    "base": 900,
    "adjustments": [{"rule": "veteran-discount", "op": "add", "value": -500, "runningTotal": 400}],
    "total": 400
  }],
  "total": 400,
  "elapsedMs": 0.07,
  "fingerprint": "2:2026-10-30T17:11:35.516699Z"
}
```

### Status contract

| Status | Cause |
|---|---|
| 401 | missing bearer, malformed/expired/wrong-iss-or-aud token, disallowed alg, unknown `kid` |
| 403 | `{env}` not in `permitted_environments`, or body tenant ≠ `tenant_id` claim |
| 400 | unknown env slug, unknown tenant, or PII guard rejection (**field path only — values are never echoed**) |

## Token claims

```json
{
  "iss": "...", "aud": "zara-engine", "sub": "...",
  "tenant_id": "aa5ce000-0000-4000-8000-0000000000ac",
  "permitted_environments": ["dev", "qa"],
  "exp": 1730000000, "nbf": 1729996400, "iat": 1729996400
}
```

Validation (MPEx validator port): **asymmetric algs only** — RS256, ES256,
EdDSA; `none` and HS* die at the header parse. `iss`/`aud`/`exp`/`nbf`/`sub`
required; `kid` required and resolved from the issuer JWKS with a bounded
refresh (300 s minimum interval) for key rotation. The management plane
owns claim minting (Z3); dex can't stamp tenant claims, so the dev path
uses `zara-devtoken`.

## Configuration

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8400` | |
| `ENGINE_DATABASE_URL` | — | required; SELECT-only `zara_engine` role |
| `OIDC_ISSUER` | — | required unless a static JWKS is set |
| `OIDC_AUDIENCE` | `zara-engine` | comma-separated |
| `OIDC_JWKS_URL` | discovery | explicit endpoint beats OIDC discovery |
| `ZARA_JWKS_JSON` / `ZARA_JWKS_FILE` | — | **dev/test only**: static JWKS, no refresh |
| `SNAPSHOT_POLL_MS` | `30000` | background fingerprint re-probe — the ADR-0004 self-heal fallback when a publish push is missed/failed |
| `GRPC_PORT` | `9443` | EngineControl gRPC listener (ADR-0004) |
| `GRPC_TLS_CERT` + `GRPC_TLS_KEY` | — | set **together** → TLS 1.3 listener; unset → h2c (dev/CI carve-out) |
| `RATE_LIMIT_PER_MIN` | `240` | per-IP token bucket (single tier — eval-only surface) |
| `RATE_LIMIT_DISABLE` | — | limits off (test only) |
| `RATE_LIMIT_TRUST_XFF` | — | honor `X-Forwarded-For` for the bucket key — only behind a proxy that overwrites it |

Body cap: **256 KB** (`DefaultBodyLimit`). Security headers on every
response: `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, deny-all CSP
+ `frame-ancestors 'none'`, restrictive `permissions-policy`.

## Local dev

```bash
# 1. data plane (once): migrations + role passwords + demo seeds
docker compose --profile setup up -d

# 2. mint a dev token (ephemeral keys — generated, never committed)
cargo run -p zara-engine --bin zara_devtoken -- \
  --tenant-id aa5ce000-0000-4000-8000-0000000000ac \
  --envs dev,qa \
  --jwks-out .devkeys/jwks.json --key-out .devkeys/dev.pem > .devkeys/token.txt

# 3a. engine via cargo
ZARA_JWKS_FILE=.devkeys/jwks.json OIDC_ISSUER=zara-devtoken cargo run -p zara-engine --bin zara_engine

# 3b. or via compose (mounts ./.devkeys)
docker compose --profile engine up -d engine

# 4. evaluate
TOKEN=$(cat .devkeys/token.txt)
curl -s http://localhost:8400/api/evaluate/dev \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"tenantId":"acme-mortgage","scenario":{"loan":{"purpose":"rateTermRefi","amount":500000},"borrower":{"vaEligible":true}}}'

# 5. HTTP latency proof (mints + boots the service itself when needed)
tests/latency/bench.sh --tenant acme-mortgage --iterations 200
```

`zara_devtoken` flags: `--tenant-id` (uuid), `--envs`, `--sub`, `--iss`,
`--aud`, `--ttl`, `--jwks-out`, `--key-out`/`--key-in` (reuse a generated
key across runs), `--kid`. It prints the token on stdout; the JWKS goes to
`--jwks-out` or stderr.

## Snapshot lifecycle

`GET`-side reads resolve through `SnapshotStore` (`(env, tenant)` →
compiled JDM behind zen `CachedLoader`): each request runs the cheap
`count:max(updated_at)` fingerprint probe, so a publish invalidates the
cached snapshot on the next call. Two convergence paths per ADR-0004:

- **gRPC push** — `EngineControl.PublishSnapshot` on `:9443` re-resolves
  the partition through the same `snapshot_for` path (fingerprint →
  rebuild on change → swap). The management plane calls it post-commit
  after a promotion; hot reload is proven by `tests/grpc.rs`.
- **Poller self-heal** — every `SNAPSHOT_POLL_MS` the store re-probes all
  cached partitions; a missed/failed push converges on the next tick.

A malformed published artifact can never brick a partition: `build()`
skips the row's loader entry but keeps its fee metadata, so eval records
a line-level error for that key (same containment as eval's per-line
errors) instead of failing the whole snapshot.

### gRPC auth + transport

Same claim contract as REST: `authorization` Bearer metadata verified by
the shared `JwtValidator` (aud `zara-engine`); the token's `tenant_id`
must equal the request's and `env` must be in `permitted_environments`
— `UNAUTHENTICATED`/`PERMISSION_DENIED`/`INVALID_ARGUMENT` map the
denial classes. Dev/CI runs h2c + verified JWT (the ADR-0004 carve-out);
prod sets `GRPC_TLS_CERT`/`GRPC_TLS_KEY` for TLS 1.3. Contract of record:
`proto/zara/engine/v1/engine.proto` (Rust stubs committed at
`src/grpc/gen/`, rebuilt by `build.rs` via vendored `protoc`).

Loader reads run **as `zara_engine`** (SELECT-only) with `zara.tenant_id`
stamped per tenant in-transaction — FORCE RLS applies to the engine role;
no rows are visible without the GUC. Eval threads never touch the pool.
