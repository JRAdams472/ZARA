# ADR 0005: Masking pipeline + PII-free engine boundary

**Status:** Accepted (locked — MPE-113 megaplan)

## Decision

Two structural defenses: (a) the **engine eval boundary** rejects PII —
recursive JSON walk with a word-boundary field-name denylist plus
value-shape regexes (SSN, bare 9-digit run, email) — the MPEx
`pii_guard` pattern, returning the field path only; (b) the **management
plane masks** — a log-masking filter rewrites sensitive keys
(`ssn`, `tax_id`, `client_name`, credential-tagged fields → `[MASKED]`)
before aggregation, and API responses redact sensitive config blocks
according to the caller's RBAC scope.

## Consequences

The engine can never be tricked into logging or persisting an identity;
loan/fee scenarios carry financial attributes only. Masking failures are
invariant-10 breakages — file as bugs, not enhancements. The denylist
and shape set are versioned in code and extended only by deliberate
review (not config), so a config typo can't silently unmask a field.
Rejected: trusting upstream callers to strip PII; post-hoc log
scrubbing at the aggregator (too late — data already left the process).
