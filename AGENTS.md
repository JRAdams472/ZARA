# Project Rules for Devin — Zara

Zara is an **enterprise multi-tenant mortgage fee engine**. Two services:

- **Execution engine** — stateless Rust microservice (axum + `zen-engine` /
  `zen-expression` v2, same engine base as MPEx). Ingests loan JSON, evaluates
  JDM decision graphs from a hot in-memory cache, returns TRID-categorized
  fee payloads. Target: **<15 ms** eval latency.
- **Management plane** — Node.js/TypeScript: multi-tenant backend, JWT/RBAC
  gatekeeper, rule-promotion orchestrator, host for the client-side JDM
  editor and the web client BFF.
- **Data** — single PostgreSQL: **schema-per-environment** (`DEV`/`QA`/`UAT`/
  `PROD`) + **Row-Level Security** on `tenant_id` for every table.

Architecture is locked by `docs/megaplan-mpe-113.md` and `docs/adr/` —
see the `milestone-planning` skill before planning any phase.

## Non-negotiable invariants

- **Deny-first zero trust** — every entry point validates JWTs against an
  alg allowlist (asymmetric only — no `none`, no symmetric-confusion);
  `tenant_id`, `user_id`, `permitted_environments` come only from verified
  claims. Cross-tenant or out-of-scope-environment requests → 403.
- **Tenant + environment isolation at the DB** — RLS policies on every
  table; app roles cannot name another tenant's rows or another
  environment's schema. Environments promote `DEV → QA → UAT → PROD` —
  no skipping.
- **Idempotent evaluation** — eval responses depend only on the request
  body plus the resolved rule snapshot. No clock, no randomness, no I/O
  inside the engine path.
- **No PII in engine payloads** — the eval boundary enforces a field-name
  denylist + value-shape guard (MPEx `pii_guard` pattern); rejections
  carry the field path only, never the value.
- **Immutable artifacts** — JDM graphs, promotions, and version history
  are append-only rows; every promotion stores a SHA-256 snapshot of the
  graph + timestamp + user ID. Never UPDATE published rows.
- **No DB I/O inside the engine** — eval runs on `!Send` (`Rc`-based)
  worker threads with pre-resolved snapshots; all I/O happens on the
  async runtime before eval threads start (MPEx invariant — never regress).
- **Append-only hash-chained audit** — mutations write attributed audit
  rows in-transaction; `sha256(prev_hash ‖ event)` chain + DB append-only
  enforcement (MPEx `audit.rs` pattern).
- **Encryption at rest** — sensitive config fields are AES-256-GCM
  ciphertext; keys behind the KMS seam (ADR-0003), external + rotatable.
- **TLS 1.3 every hop** — consumer→mgmt, consumer→engine, Node→Rust gRPC,
  →Postgres. Dev loopback is the documented exception; HSTS lives at the
  terminator (see `docs/security.md` when it lands).
- **Zero sensitive values in logs** — masking filter strips `ssn`,
  `tax_id`, `client_name`, and credential-tagged fields before
  aggregation; API responses redact sensitive blocks per caller RBAC scope.
- **Secrets never in repo** — `.env` gitignored, compose interpolates
  `${VAR:?}` and fails closed, `.env.example` ships placeholders only.
  `.devin/mcp_config.local.json` stays untracked. gitleaks runs in CI.

## Ticket Execution — Acceptance Criteria (required)

- **Read the ticket first.** Before writing code for an MPE ticket, read
  the FULL Linear issue — the Scope and Acceptance bullets are the
  contract, not a suggestion.
- **Implement the Scope; prove the Acceptance.** Every Acceptance bullet
  gets a real check — run the command, hit the endpoint, open the page.
- **Stay in scope.** A ticket is done only when ITS acceptance is green.
- **Proof maps 1:1 to Acceptance bullets** — the completion comment on
  the sub-issue addresses each bullet explicitly with run output.
- **Plan-comment for ambiguous tickets** — mechanical tickets go straight
  to implementation; tickets with real design decisions get a short
  implementation-plan comment on the sub-issue when marking In Progress.
  Detailed phase plans are written at phase start (rolling-wave), citing
  the conforming ADRs per the `milestone-planning` skill.

## Git Workflow

- Each phase of a plan is developed on its own ticket-prefixed branch:
  `MPE-<n>-phase-<m>` (e.g. `MPE-140-phase-2`). Descriptive slugs allowed
  after the ticket: `MPE-140-rls-tables`.
- **One PR per phase subticket (required)** — never batch phase tickets
  into a single PR.
- **Never commit directly to `main`.** Every change — including bootstrap
  and docs — lands on a ticket-prefixed branch via pull request. Branches
  and PR titles must start with the Linear ticket number:
  `MPE-140: Phase 2 — tenant RLS`.
- **Do not open a PR without a Linear ticket.**
- **Always pause after opening a PR.** Present the PR link + proof, then
  wait for the user's explicit approval — never self-merge, never merge
  on a schedule, never assume approval carries over between PRs.
- Before opening a PR: `cargo fmt`, `cargo clippy --all-targets --
  -D warnings`, `cargo test`; Node `lint`/`typecheck`/`test`/`build` all
  green (whichever surfaces exist at that milestone). Commit lockfiles
  (`Cargo.lock`, `package-lock.json`) — CI fails when they drift.

## Linear Workflow (required)

- Team **MPE**, project **Zara**. Every plan gets a **parent ticket**;
  once planning is done and work begins, the parent moves to
  **In Progress**.
- **Attach the plan document to the parent ticket before creating phase
  sub-issues** — the megaplan goes on the parent first, then the
  subtickets.
- Every phase gets a **sub-issue** under the parent named for its branch,
  with scope + acceptance criteria; mark it **In Progress** when its
  phase starts.
- On phase completion, post **proof of completion** on the sub-issue
  **before asking for merge approval and before moving the ticket toward
  Done** — a sub-issue never closes on "looks good":
  - Relevant run logs (build/test/verification output).
  - **Playwright screenshots** of any user-facing change (the `playwright`
    MCP is configured — capture real screens, don't describe them).
  - A link/summary of the **GitHub CI run** showing all checks green.
  - Proof maps 1:1 to the ticket's Acceptance bullets — every bullet gets
    an explicit check, not verification-by-inspection.
- Linear attachments: `prepare_attachment_upload` → PUT the file to the
  signed URL with the exact signed headers →
  `create_attachment_from_upload`. `SignatureDoesNotMatch` means the
  headers drifted — request a fresh URL and PUT immediately (~60s expiry).

## Code Conventions

- Rust: handlers return `Result<_, AppError>`; errors map in a single
  error module (RFC 9457 problem-details shape). Migrations are
  append-only `migrations/NNNN_name.sql`.
- Rule artifacts resolve through a snapshot store (MPEx
  `rules/snapshot.rs` pattern): one snapshot query per request scope
  `(tenant, environment)`, then pure eval on `spawn_blocking`
  current-thread runtimes — keep it that way.
- Node: strict TypeScript; JWT context-injection middleware runs before
  any handler logic; repositories never see plaintext sensitive fields
  outside the cipher boundary.
- Web (when it lands): App Router + typed fetch helpers in `lib/`; the
  GoRules `@gorules/jdm-editor` loads client-only (`ssr: false`); dark
  GitHub-dark palette per sibling convention; LENA2 module patterns
  (typed api client, theme vars, oauth helpers).
- Boy-scout rule: fix trivial adjacent issues in a touched file when
  low-risk; never let it balloon the diff.

## Evidence Gathering (Observability)

Seq and Jaeger run in the compose stack and are both queryable over plain
HTTP — no MCP needed. Use them to attach runtime evidence (logs, traces)
to phase proof-of-completion.

- **Seq** (structured logs, `http://localhost:5641` — Zara port block):
  `curl -s 'http://localhost:5641/api/events?count=50'`; filter with Seq
  expressions (`filter=level = 'ERROR'`).
- **Jaeger** (traces, `http://localhost:19686` — v2 API under `/api/v3/`):
  `curl -s 'http://localhost:19686/api/v3/services'`; `start_time_min`/
  `start_time_max` are REQUIRED and must be RFC3339.
- **Raw fallback**: `docker logs zara-engine-1 --since 30m` /
  `docker logs zara-mgmt-1 --since 30m` (JSON output).
- **SonarQube** (`http://localhost:9000`, project key `zara`): the
  `sonarqube` MCP server exposes issues/hotspots/quality-gate tools.
  Rescan by mounting **source subdirs only** — a whole-repo mount crawls
  `node_modules` and CI leftovers.
- **MCP helpers configured** (`.devin/mcp_config.local.json`, gitignored):
  `playwright`, `linear`, `github`, `sonarqube`.
- **No sensitive values in evidence** — Seq/Jaeger payloads and
  `docker logs` output must never contain unmasked sensitive data; if
  they do, that's an invariant breakage — file it as a bug and redact
  before quoting in tickets.

## Milestone Hardening Gate (required before milestone close)

Every milestone ends with a deep-dive hardening pass — not just the final
close-out milestone:

1. **OWASP review** of the milestone's attack surface (Top 10):
   injection, broken access control (tenant/env boundaries!), crypto
   failures, auth/session weaknesses, security misconfiguration,
   vulnerable/outdated dependencies, logging failures (**esp. unmasked
   sensitive data**), SSRF on outbound calls, upload/file handling.
2. **Application hardening:** error-model consistency, rate limits,
   timeouts, input-validation coverage, secrets handling,
   new-dependency review (free/OSS and published ≥7 days).
3. **Architecture overview:** code vs. `docs/adr/*` + the megaplan — any
   drift is flagged and fixed, or escalated as an ADR amendment with
   user approval; never merged silently.
4. Findings post as a **comment on the milestone ticket**. Critical
   findings are fixed before close; the rest become Linear tickets.
   **A milestone is not Done until its hardening-gate comment exists.**

## Plan Close-Out

After the final phase of a plan merges, before starting the next:

1. Delete merged phase branches locally and on GitHub (verify PR state
   with `gh` first).
2. Ensure no new feature is left at zero test coverage — every new
   service, handler, or page needs at least one unit or integration test.
3. Re-walk corrected audit/threat-model findings for regressions.
4. File Linear tickets (project **Zara**, or the correct sibling project)
   for improvements or new features inspired by the completed work.
5. Update `README.md` so features and architecture reflect what shipped —
   including sweeping for stale claims (endpoint lists, env vars,
   workflow names).
6. Review every doc listed in `README.md`'s Documentation section plus
   touched `clients/*/README.md` files for staleness.
7. Update the GitHub wiki (`Zara.wiki.git`) — it lives outside the repo,
   so clone it, add/refresh pages for what shipped, and push to `master`.
8. Refresh wiki **screenshots** when user-facing screens changed: run the
   isolated `zarashots` stack per `.devin/skills/wiki-screenshots`,
   inspect every PNG for spinners, publish under `images/`, and embed on
   the relevant pages — **and verify no real or realistic PII appears in
   any screenshot** (synthetic tenants/scenarios only).
9. **SonarQube rescan gate (required):** if the plan remediated SonarQube
   findings, run the documented rescan after the final phase merges and
   confirm **zero new open issues** beyond the plan's accepted `wontfix`
   list — a finding introduced by the plan's own code is a regression,
   not backlog. Record the final open-issue count in the close-out proof.

## Code Size & Shape Report (required on every ticket marked complete)

Post a code-shape report as a comment on **every** Linear ticket when it
is marked Done — phase sub-issues and parent tickets alike. Report
absolute numbers, and deltas vs. the previous report if one exists on an
earlier ticket.

1. **Per-language LOC** — tokei (winget; if not on PATH it's at
   `%LOCALAPPDATA%\Microsoft\WinGet\Packages\XAMPPRocky.Tokei_*\tokei.exe`):
   `tokei -e node_modules -e target -e dist src services clients
   migrations tests` (adjust roots as the tree lands).
   Call out generated code separately.
2. **Source vs. test split** — bucket tracked files (`git ls-files`) by
   path: Rust tests `tests/**` + `#[cfg(test)]`; Node/web tests
   `__tests__`, `*.test.*`, `*.spec.*`, `e2e`. Everything else is source.
   Sum `wc -l` per bucket; "executable lines" = non-blank non-comment.
3. **Test counts** — `#[test]`/`tokio::test` per crate; `it(|test(` in
   Node/web suites.
4. **Coverage** — engine: `cargo llvm-cov` or `tarpaulin` (decided at Z2);
   Node/web: `npx vitest run --coverage` / `npm test -- --coverage` —
   always note the report date; stale reports must be flagged.
5. **Post** — `save_comment` on the ticket with the report as a markdown
   table: LOC / executable / test LOC / test count / coverage per feature
   area, plus a one-line caveats section (generated code excluded, stale
   reports, skipped suites).

## Verification Commands

```bash
# Bootstrap (Z0): nothing builds yet — compose validation is the gate.
docker compose config
# Engine (from Z2):
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
# Management plane (from Z3):
npm run lint && npm run typecheck && npm test -- --ci && npm run build
# Full stack: docker compose up --build
```
