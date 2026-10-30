# ADR 0003: KMS seam for field encryption

**Status:** Accepted (locked — MPE-113 megaplan)

## Decision

Sensitive configuration fields (third-party API keys, tenant metadata
secrets) are encrypted **before** database insertion with authenticated
**AES-256-GCM**, behind a field-cipher interface (`encrypt`/`decrypt`/
`rewrap`). Key material lives in an **external KMS** — never in the
database, env files, or repo.

## Consequences

Production targets a cloud KMS with automated rotation; the cipher
interface hides it so repositories never see plaintext outside the
boundary. The **dev implementation is decided at Z3 phase start** —
candidate: OpenBao transit (sibling convention from LOLA) or a local
KEK file for loopback dev. Rotation = rewrap job that re-encrypts under
the active data key; ciphertext is versioned (`v1:`-style envelope) so
mixed-key rows decrypt correctly during rotation. Rejected: pgcrypto
in-DB keys (key lives next to ciphertext); plaintext-until-prod (breaks
invariant 7 in every environment, not just prod).
