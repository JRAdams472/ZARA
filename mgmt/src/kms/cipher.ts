//! Field-cipher seam (ADR-0003) — the only surface that ever sees
//! plaintext. Repositories store `vault:vN:` envelopes verbatim plus the
//! transit `key_name`; a future cloud KMS replaces the adapter behind
//! this interface without touching routes or persistence.

import { HttpError } from '../plugins/errors.js';

/** Versioned ciphertext envelope emitted by transit backends. */
export const ENVELOPE_RE = /^vault:v(\d+):[A-Za-z0-9+/=_-]+$/;

export function isEnvelope(s: string): boolean {
  return ENVELOPE_RE.test(s);
}

/** Key version embedded in an envelope (`vault:v7:…` → "7"). */
export function envelopeVersion(envelope: string): string | undefined {
  return ENVELOPE_RE.exec(envelope)?.[1];
}

/** KMS unavailable/unreachable — mapped to HTTP 503 at the boundary. */
export class KmsUnavailableError extends HttpError {
  constructor(message = 'KMS not configured') {
    super(503, message);
    this.name = 'KmsUnavailableError';
  }
}

export interface FieldCipher {
  /** Transit key sealing these envelopes (metadata only, never material). */
  readonly keyName: string;
  /** UTF-8 plaintext → `vault:vN:` envelope. */
  encrypt(plaintext: string): Promise<string>;
  /** `vault:vN:` envelope → UTF-8 plaintext. */
  decrypt(envelope: string): Promise<string>;
  /** Re-seal an envelope under the key's latest version — plaintext
   *  never crosses the wire during rotation. */
  rewrap(envelope: string): Promise<string>;
}
