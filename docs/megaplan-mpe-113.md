# Zara Megaplan — MPE-113

Enterprise multi-tenant **mortgage fee engine**. A Node.js/TypeScript
management plane (multi-tenant backend, JDM rule editor host, RBAC
gatekeeper, rule-promotion orchestrator) drives a stateless Rust
execution service that embeds `zen-engine`/`zen-expression` v2 — the
same rule-engine base as MPEx — to evaluate JDM decision graphs from a
hot in-memory cache and return TRID-categorized fee payloads in under
15 ms. A single PostgreSQL cluster enforces **schema-per-environment**
(`DEV`/`QA`/`UAT`/`PROD`) plus **Row-Level Security** on `tenant_id`.
Business rules promote `DEV → QA → UAT → PROD` through a structured,
no-skip, SHA-256-snapshotted, append-only lifecycle.

MVP data flow (per MPE-113):
`Loan JSON → JWT gate → resolved (tenant, env) snapshot → zen eval → TRID fee payload`
`JDM edit (DEV) → promote → SHA-256 snapshot + audit → engine hot-reload`

## Architecture (decided)

| Layer | Choice |
|---|---|
| Execution engine | Rust — axum + `zen-engine`/`zen-expression` v2 (MPEx engine base: `!Send` `Rc` eval workers, pre-resolved snapshots, idempotent eval) |
| Management plane | Node.js/TypeScript — JWT gatekeeper, promotion orchestrator, JDM-editor host, web BFF |
| Internal contract | **gRPC** Node→Rust (snapshot publication + cache hot-reload); consumer eval calls hit the engine's REST surface directly — proto contract defined at Z4 phase start |
| Data | PostgreSQL — schema-per-environment (`zara_dev`/`zara_qa`/`zara_uat`/`zara_prod`) + RLS per tenant; append-only `migrations/NNNN_name.sql` |
| Identity | JWT/JWKS resource-server validation in **both** planes — **Dex** dev IdP (MPEx pattern: auth-code+PKCE web, client-credentials services), Auth0/Okta-class IdP in prod |
| KMS seam | field-cipher interface — AES-256-GCM; dev impl (OpenBao transit vs. local KEK) decided at Z3 phase start; prod = external cloud KMS with rotation |
| Observability | OTel → Seq (logs, `:5641`) + Jaeger (traces, `:19686`); masking filter before aggregation |
| Web client | **Decided at Z5 phase start** — default Next.js App Router + TS + React Query, GitHub-dark palette; LENA2 module patterns + `.devin/skills` (design-taste-frontend, impeccable) |
| Ports | engine `:8400`, mgmt `:8401`, web `:3400`, dex `:5656`, postgres `:5532`, seq `:5641`, jaeger `:19686` (Zara block — sibling-coexistence) |

## Security invariants

1. Deny-first zero trust — JWT alg allowlist (asymmetric only) at both
   entry points; `tenant_id`/`user_id`/`permitted_environments` from
   verified claims only; violations → 403.
2. DB-enforced isolation — RLS on every table; app roles cannot cross
   tenants or environment schemas.
3. No PII in engine payloads — field-name denylist + value-shape guard
   at the eval boundary (MPEx `pii_guard` pattern).
4. Immutable artifacts — JDM graphs, promotions, version history are
   append-only; every promotion stores SHA-256(graph) + timestamp +
   user ID. No skipping `DEV→QA→UAT→PROD`.
5. Idempotent eval — response = f(request, resolved snapshot); no
   clock/RNG/IO in the engine path.
6. Append-only hash-chained audit — attributed rows written
   in-transaction; `sha256(prev‖event)` chain + DB append-only trigger.
7. AES-256-GCM at rest for sensitive config fields — keys via external
   KMS seam, rotatable.
8. TLS 1.3 on every hop (consumer→mgmt, consumer→engine, Node→Rust gRPC,
   →Postgres); dev loopback is the documented exception; HSTS at the
   terminator.
9. Edge hardening — per-IP rate limits (global + mutation buckets, XFF
   only behind a trusted proxy), body caps, strict input validation,
   security headers, locked-down CORS.
10. Zero sensitive values in logs — masking filter (`ssn`, `tax_id`,
    `client_name`, credential tags → `[MASKED]`); RBAC-scoped response
    redaction on the management API.
11. Secrets never in repo — `.env` gitignored, `${VAR:?}` fail-closed
    compose, placeholder-only `.env.example`, gitleaks in CI.
12. CI security gates — cargo fmt/clippy/test; npm lint/typecheck/test/
    build; cargo audit + filtered npm-audit gate (exception file with
    justification); gitleaks; SonarQube scan + quality gate; dependabot.
13. Dependency hygiene — free/OSS, published ≥7 days, lockfiles
    committed (`Cargo.lock`, `package-lock.json`).

## Milestones — Linear tickets

Each milestone is a Linear sub-issue under parent **MPE-113** (project
**Zara**, team MPE) and receives its own phase-level plan
(`MPE-<n>-phase-<m>` branches) **when its phase starts** — rolling-wave
planning; subtickets carry base scope + acceptance only. ZARA-Mn slugs
carry ordering.

| # | Milestone | Ticket | Depends on |
|---|---|---|---|
| Z0 | Workspace & tooling bootstrap — repo scaffold, AGENTS.md, `.devin` config + skills, megaplan, `docs/adr/` seeds, dotfiles, CI skeleton (gitleaks, fmt/lint placeholders), compose skeleton (postgres + dex + seq + jaeger) | MPE-140 | — |
| Z1 | Postgres data plane — tenancy & environments: schema-per-env topology, tenant registry, RLS policies + per-env app roles, append-only migrations, seed fixtures, cross-tenant/cross-schema isolation tests | MPE-141 | Z0 |
| Z2 | Rust execution engine — axum + zen-engine, env+tenant-scoped JDM snapshot loader + hot in-memory cache, `POST /evaluate`, idempotent `!Send` eval path, PII guard, rate limits/headers, JWT resource-server validation, <15 ms latency benchmark | MPE-142 | Z1 |
| Z3 | Management plane core — Node/TS service, JWT verify + context injection, deny-first 403, RBAC roles (Tenant Auditor / Rule Engineer / Release Manager) + grants admin, AES-256-GCM field cipher behind KMS seam, log-masking filter, RBAC-scoped redaction, hash-chained audit | MPE-143 | Z1 |
| Z4 | Rule lifecycle & promotion — JDM rule CRUD in DEV, promote API DEV→QA→UAT→PROD w/ no-skip enforcement, SHA-256 snapshot + attributed append-only version history, Release-Manager PROD sign-off, Node→Rust gRPC publish + cache hot-reload | MPE-144 | Z2, Z3 |
| Z5 | Management UI — JDM editor host (`@gorules/jdm-editor` client-only), rule/decision views, promotion pipeline UI w/ RBAC gating, tenant admin/env-grant screens; web stack finalized at phase start | MPE-145 | Z3, Z4 |
| Z6 | MVP validation & hardening — two-tenant isolation demo, DEV→PROD lifecycle e2e, <15 ms TRID eval proof, OWASP gate + STRIDE, TLS topology + `docs/security.md`, README/wiki, size report, close-out tickets | MPE-146 | Z4, Z5 |

## Notes

- Z0 bootstrap lands the megaplan + rules + `.devin` assets on its own
  ticket-prefixed branch (`MPE-140-phase-1`).
- **Every milestone ends with a hardening gate** — OWASP + application
  hardening + architecture/ADR review; findings post as a ticket comment
  before the milestone can close (per `AGENTS.md`). Z6 is the deep pass
  across the whole system on top of the per-milestone gates.
- Deferred decisions (recorded here so phases don't relitigate them
  silently): management-plane web stack (Z5), dev KMS implementation
  (Z3), gRPC proto + hot-reload semantics (Z4), coverage toolchain for
  Rust (Z2).
- MPEx provenance: eval-path invariants (`!Send` workers, pre-resolved
  snapshots, idempotency), `pii_guard`, `limits` (token buckets),
  `audit` (hash chain + append-only trigger), `auth/validator` (alg
  allowlist JWKS), grants-admin pattern (MPE-120), dep-audit gate
  (MPE-123), SonarQube CI (MPE-135). These are *patterns to port*, not
  shared code — Zara is its own repo and binary set.
- E-signature, document packaging, LOS intake are sibling scope
  (ISPPr/LOLA) — Zara's surface ends at evaluated fee payloads and rule
  lifecycle management.
