# Zara

**Zara** is an enterprise multi-tenant **mortgage fee engine**: a
Node.js/TypeScript management plane (JDM rule editor, RBAC gatekeeper,
`DEV→QA→UAT→PROD` rule promotion) driving a stateless Rust
`zen-engine` execution service that returns TRID-categorized fee
payloads in under 15 ms — over a shared PostgreSQL cluster with
schema-per-environment isolation and row-level tenant security.

**Status:** Z4 rule lifecycle + promotion shipped — dev JDM CRUD/publish
and unskippable `DEV→QA→UAT→PROD` promotion on `zara_promote`, with a
post-commit gRPC `PublishSnapshot` push that hot-reloads the engine
cache without a restart (`:9443`, h2c+JWT dev / TLS 1.3 prod; poller
self-heals on a missed push). Z3 management plane: `zara-mgmt` (Fastify +
postgres.js) serves RBAC grants admin, env-scoped authorization, the
per-tenant hash-chained audit trail, and OpenBao-sealed tenant secrets
(`vault:v1:` envelopes, metadata-only API, RBAC-scoped serialization)
on `:8401` behind deny-first JWT gating (service guide:
[docs/mgmt.md](docs/mgmt.md)). Z2 execution engine:
`zara-engine` serves `POST /api/evaluate/{env}` on `:8400`
([docs/engine.md](docs/engine.md)). Z1 data plane (schemas/roles/RLS +
demo seeds) provisions via `docker compose --profile setup up -d`
(runbook: [docs/data-plane.md](docs/data-plane.md)).

## Documentation

| Doc | What |
|---|---|
| [docs/megaplan-mpe-113.md](docs/megaplan-mpe-113.md) | Milestone plan + security invariants (Linear parent: MPE-113) |
| [docs/adr/](docs/adr/README.md) | Locked architecture decisions |
| [docs/data-plane.md](docs/data-plane.md) | Z1 runbook — schemas, roles, RLS, seeds |
| [docs/engine.md](docs/engine.md) | Z2 service guide — endpoints, claims, dev tokens, bench |
| [docs/mgmt.md](docs/mgmt.md) | Z3 service guide — RBAC, grants admin, audit chain, secrets/KMS, masking |
| [docs/web.md](docs/web.md) | Z5 console guide — PKCE session, dev token exchange, BFF, env gating |
| [docs/fee-model.md](docs/fee-model.md) | Fee rule model — base_fee + adjustment_set |
| [AGENTS.md](AGENTS.md) | Workflow, invariants, verification rules |

## Stack (locked)

| Layer | Technology |
|---|---|
| Execution engine | Rust, axum, `zen-engine`/`zen-expression` v2 |
| Management plane | Node.js/TypeScript |
| DB | PostgreSQL — schema-per-env + RLS |
| Identity | JWT via OIDC (Dex dev / enterprise IdP prod) |
| Internal contract | gRPC Node→Rust |
| Dev/deploy | Docker Compose (`docker compose up --build`) |
