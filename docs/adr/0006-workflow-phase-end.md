# ADR 0006: Workflow + phase-end rule set

**Status:** Accepted (locked — MPE-113 megaplan)

## Decision

Zara follows the MPEx git/Linear workflow (ticket-prefixed
`MPE-<n>-phase-<m>` branches, one PR per subticket, no direct-to-main,
pause-after-PR until explicit user approval) and the **full LOLA
phase-end rule set**:

1. Proof-of-completion mapping **1:1 to acceptance bullets**.
2. **Milestone hardening gate** (OWASP + app hardening + ADR-drift)
   before any milestone closes — findings comment required.
3. **Code size & shape report on every ticket** marked Done.
4. Plan close-out sweep — branch cleanup, zero-coverage check,
   follow-up tickets, README/docs/wiki refresh + screenshots, SonarQube
   rescan gate.

## Consequences

Phase subtickets carry base scope + acceptance at creation; the detailed
phase plan is written at phase start (rolling-wave planning) and must
cite the conforming ADRs per the `milestone-planning` skill. Coverage
floor details are decided when each language surface lands (Z2 Rust,
Z3 Node) — sibling convention is ~80%/module, and the report format is
fixed in `AGENTS.md` regardless of toolchain.
