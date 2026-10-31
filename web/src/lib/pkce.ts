//! PKCE primitives (RFC 7636) — verifier/challenge/state generation.
//! Edge-safe: node:crypto only.

import { createHash, randomBytes } from 'node:crypto';

const b64url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function genVerifier(): string {
  return b64url(randomBytes(32));
}

export function genChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function genState(): string {
  return b64url(randomBytes(16));
}
