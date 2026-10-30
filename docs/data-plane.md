# Data plane runbook (Z1)

The PostgreSQL data plane per ADR-0002: one cluster, a `zara_control`
registry schema, and four environment schemas (`zara_dev`, `zara_qa`,
`zara_uat`, `zara_prod`) with identical DDL. Every tenant-scoped table is
protected by `FORCE ROW LEVEL SECURITY` keyed on the `zara.tenant_id`
GUC — **no GUC means zero rows, even for the table owner**.

## Roles

| Role | Purpose | Can reach |
|---|---|---|
| `zara` | cluster superuser (bootstrap only) | everything — bypasses RLS |
| `zara_migrate` | DDL owner + seed writer | all schemas; DML still bound by FORCE RLS |
| `zara_app_<env>` | data-plane service role | its own `zara_<env>` schema only |
| `zara_promote` | promotion path (Z4) | SELECT + INSERT across all four env schemas |

Passwords are provisioned out-of-band by `zara-migrate
--set-role-passwords` from `ZARA_*_PASSWORD` env vars — never stored in
SQL or tracked files.

## Bring-up

```bash
cp .env.example .env          # then fill in every ${VAR} — compose fails closed
docker compose --profile setup up -d --build
```

Startup order: `db` healthy → `migrate` applies bootstrap + control +
env ×4 and sets role passwords (exits 0) → `seed` loads the demo tenants
and fee artifacts (exits 0). Requires compose v2.20+ for
`service_completed_successfully`. Check completion:

```bash
docker compose --profile setup ps     # migrate + seed should show Exit 0
```

First `--build` compiles `zara-migrate` inside the image (a few minutes);
later runs reuse it. Migrations and seeds are idempotent — re-running is
safe and inserts nothing new.

Verify by hand:

```bash
psql postgres://zara:$POSTGRES_PASSWORD@localhost:5532/zara \
  -c "SELECT slug FROM zara_control.tenants;" \
  -c "SELECT count(*) FROM zara_prod.rule_artifacts;"
```

## Connecting (the GUC contract)

`zara.tenant_id` is a custom GUC the middleware will stamp from verified
JWT claims (Z3) — never from request payloads. Until then, set it by hand
for any session doing data-plane DML or reads:

```bash
psql postgres://zara_app_dev:$ZARA_APP_DEV_PASSWORD@localhost:5532/zara
```

```sql
SET zara.tenant_id = 'aa5ce000-0000-4000-8000-0000000000ac';  -- acme-mortgage
SELECT key, kind, status FROM zara_dev.rule_artifacts;       -- acme rows only
```

Inside containers the same roles connect at `db:5432` instead of
`localhost:5532`.

## Adding a migration

Three append-only sets under `migrations/` — pick exactly one:

| Set | Runs as | Applies to | Use for |
|---|---|---|---|
| `bootstrap/` | admin (`DATABASE_URL`) | cluster | roles, schemas, grants |
| `control/` | `zara_migrate` | `zara_control` | tenant registry tables |
| `env/` | `zara_migrate` per schema | every `zara_<env>` | tenant-scoped tables — write once, applied identically ×4 via `SET search_path` |

File naming is `NNNN_name.sql`, strictly increasing, **never edited
after merge**. sqlx records each file in that schema's own
`_sqlx_migrations` ledger; `t05` diffs the ledgers and full DDL signature
across all four env schemas — schema drift fails CI.

Apply from the host: `cargo run -p zara-migrate` (env DSNs from `.env`),
or re-run the compose `migrate` service.

## Control-plane tables (Z3)

`control/0003` owns the management-plane tables, all tenant-scoped under
FORCE RLS: `role_grants` (subject → RBAC role, resolved per request —
see `docs/mgmt.md`), `audit_events` (append-only per-tenant hash chain),
and `tenant_secrets`. `tenant_secrets` stores **`vault:vN:` ciphertext
envelopes only** — sealed by the OpenBao transit seam (ADR-0003) before
insert; the plaintext never reaches the database. `zara_mgmt` holds
`SELECT`+`INSERT`/`UPDATE` on it; DELETE is not granted anywhere. The
secret value itself is managed through the mgmt API
(`PUT/POST /api/admin/secrets/…`), never by direct SQL.

## Seeds and reset

`seed/001_demo_tenants.sql` (control registry) + `seed/002_demo_fees.sql`
(every env schema) run once via the `seed` service — or by hand:

```bash
psql postgres://zara_migrate:$ZARA_MIGRATE_PASSWORD@localhost:5532/zara \
  -v ON_ERROR_STOP=1 -f seed/001_demo_tenants.sql -f seed/002_demo_fees.sql
```

Seeds are idempotent (`ON CONFLICT … DO NOTHING`). Full reset:

```bash
docker compose down -v        # drops the pgdata volume
docker compose --profile setup up -d --build
```

## Isolation suite

`tests/isolation/` — bash + psql, runs against a live database:

```bash
# inside the db container (psql ships with the image):
docker cp tests/isolation zara-db-1:/tmp/isolation
docker exec -e PGHOST=localhost -e PGPORT=5432 -e PGDATABASE=zara \
  -e POSTGRES_PASSWORD -e ZARA_APP_DEV_PASSWORD -e ZARA_APP_QA_PASSWORD \
  -e ZARA_APP_UAT_PASSWORD -e ZARA_APP_PROD_PASSWORD -e ZARA_PROMOTE_PASSWORD \
  zara-db-1 bash /tmp/isolation/run.sh
```

or on a host with a psql client: `PGPORT=5532 bash tests/isolation/run.sh`
with the same env vars exported.

| Test | Invariant proven |
|---|---|
| t01 | Cross-tenant SELECT denied; wrong-tenant INSERT hits WITH CHECK |
| t02 | `zara_app_<env>` cannot reach another env's schema |
| t03 | Unset `zara.tenant_id` → zero rows (fail-closed) |
| t04 | `promotion_history`/`audit_events` append-only; published artifacts immutable |
| t05 | Identical DDL + `_sqlx_migrations` ledgers across all four env schemas |
| t06 | `FORCE RLS` binds even the table owner |
| t07 | Seeded artifacts visible only under the owning tenant's GUC (skips if unseeded) |
