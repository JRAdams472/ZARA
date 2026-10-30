# Zara

**Zara** is an enterprise multi-tenant **mortgage fee engine**: a
Node.js/TypeScript management plane (JDM rule editor, RBAC gatekeeper,
`DEV→QA→UAT→PROD` rule promotion) driving a stateless Rust
`zen-engine` execution service that returns TRID-categorized fee
payloads in under 15 ms — over a shared PostgreSQL cluster with
schema-per-environment isolation and row-level tenant security.

**Status:** Z2 execution engine landed — `zara-engine` serves
`POST /api/evaluate/{env}` on `:8400` behind JWT auth, per-IP limits, and a
PII-free eval boundary, backed by hot per-(env,tenant) JDM snapshots
(service guide: [docs/engine.md](docs/engine.md)). Z1 data plane
(schemas/roles/RLS + demo seeds) provisions via
`docker compose --profile setup up -d` (runbook:
[docs/data-plane.md](docs/data-plane.md)). Management plane lands in Z3.

## Documentation

| Doc | What |
|---|---|
| [docs/megaplan-mpe-113.md](docs/megaplan-mpe-113.md) | Milestone plan + security invariants (Linear parent: MPE-113) |
| [docs/adr/](docs/adr/README.md) | Locked architecture decisions |
| [docs/data-plane.md](docs/data-plane.md) | Z1 runbook — schemas, roles, RLS, seeds |
| [docs/engine.md](docs/engine.md) | Z2 service guide — endpoints, claims, dev tokens, bench |
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
