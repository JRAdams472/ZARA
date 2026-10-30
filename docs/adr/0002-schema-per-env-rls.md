# ADR 0002: Schema-per-environment + RLS tenancy

**Status:** Accepted (locked — MPE-113 megaplan)

## Decision

One PostgreSQL cluster. Each tenant's rule data lives in **four
environment schemas** (`zara_dev`, `zara_qa`, `zara_uat`, `zara_prod`)
with identical DDL; every table carries a mandatory `tenant_id` column
protected by **native Row-Level Security** policies. Application roles
connect with RLS enforced — a cross-tenant read is impossible at the
database layer regardless of app-code bugs.

## Consequences

Tenant context arrives only via verified JWT claims and is stamped on
the connection/session (`SET app.tenant_id`) before any data-plane
query — never trusted from payloads. Promotion is a controlled
cross-schema copy performed by the management plane's privileged role
through the promotion API — the only sanctioned cross-schema path.
Migrations are append-only `migrations/NNNN_name.sql` applied uniformly
to all four environment schemas; a schema drift between environments is
a defect. Rejected: database-per-tenant (operational cost at scale);
column-level env flags in one schema (breaks the promotion-isolation
and blast-radius requirements).
