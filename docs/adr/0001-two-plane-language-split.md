# ADR 0001: Two-plane language split

**Status:** Accepted (locked — MPE-113 megaplan)

## Decision

Zara is two deployables: a **Rust execution engine** (axum +
`zen-engine`/`zen-expression` v2 — the MPEx engine base) and a
**Node.js/TypeScript management plane** (multi-tenant backend, promotion
orchestrator, JDM-editor host, web BFF).

## Consequences

The eval hot path is Rust-only and never crosses a network boundary —
required for the <15 ms latency benchmark and the `!Send` worker-thread
eval invariant. The management plane owns everything latency-tolerant:
authz decisions, promotion writes, editor hosting. Neither plane may
absorb the other's role — no eval logic in Node, no admin CRUD in Rust.

Rejected: single-language monolith (splits the zen-engine from its
native crate or burdens the eval path with orchestration); Go engine
(rejected in favor of the proven MPEx zen-engine base).
