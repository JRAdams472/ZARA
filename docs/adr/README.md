# Architecture Decision Records — Zara

Locked decisions for the MPE-113 megaplan. **Milestone plans must conform
to these records.** Any proposed change requires an amended ADR plus
explicit user approval *before* code — never drift silently.

| ADR | Decision |
|---|---|
| [0001](0001-two-plane-language-split.md) | Rust execution engine + Node.js/TypeScript management plane |
| [0002](0002-schema-per-env-rls.md) | Shared Postgres: schema-per-environment + RLS per tenant |
| [0003](0003-kms-seam-field-encryption.md) | AES-256-GCM field encryption behind a KMS seam |
| [0004](0004-grpc-plane-contract.md) | gRPC Node→Rust internal contract; REST consumer surface |
| [0005](0005-masking-pii-free-engine.md) | Log masking + RBAC redaction; no PII past the eval boundary |
| [0006](0006-workflow-phase-end.md) | PR-only + pause-after-PR; LOLA phase-end rule set |
