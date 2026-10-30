# Zara

**Zara** is an enterprise multi-tenant **mortgage fee engine**: a
Node.js/TypeScript management plane (JDM rule editor, RBAC gatekeeper,
`DEV→QA→UAT→PROD` rule promotion) driving a stateless Rust
`zen-engine` execution service that returns TRID-categorized fee
payloads in under 15 ms — over a shared PostgreSQL cluster with
schema-per-environment isolation and row-level tenant security.

**Status:** bootstrap — the repo currently carries the megaplan,
architecture decision records, agent rules, and tooling skeleton only.
Application code lands with milestones Z1+.

## Documentation

| Doc | What |
|---|---|
| [docs/megaplan-mpe-113.md](docs/megaplan-mpe-113.md) | Milestone plan + security invariants (Linear parent: MPE-113) |
| [docs/adr/](docs/adr/README.md) | Locked architecture decisions |
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
